const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function backend(){
  const properties = {};
  const context = vm.createContext({
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => (key in properties ? properties[key] : null),
      setProperty: (key, value) => { properties[key] = value; }
    })},
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: value => Buffer.from(value).toString('base64'),
      base64Decode: value => Buffer.from(value, 'base64'),
      newBlob: bytes => ({getDataAsString: () => Buffer.from(bytes).toString('utf8')}),
      computeHmacSha256Signature: (value, key) => crypto.createHmac('sha256', key).update(String(value)).digest()
    }
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context);
  return {context, properties};
}

test('issueSessionToken_ / verifySessionToken_ round-trip carries email, name and an ~8h expiry', () => {
  const b = backend();
  const before = Date.now();
  const token = b.context.issueSessionToken_('person@example.com', 'Alex Person');
  const session = b.context.verifySessionToken_(token);
  assert.equal(session.email, 'person@example.com');
  assert.equal(session.name, 'Alex Person');
  assert.ok(session.exp > before + 7.9 * 60 * 60 * 1000);
  assert.ok(session.exp <= before + 8 * 60 * 60 * 1000 + 5000);
});

test('the session secret is generated once and reused, so a token stays verifiable across separate calls', () => {
  const b = backend();
  const token = b.context.issueSessionToken_('a@example.com', '');
  assert.ok(b.properties.SESSION_SECRET);
  const secretAfterIssue = b.properties.SESSION_SECRET;
  assert.equal(b.context.verifySessionToken_(token).email, 'a@example.com');
  assert.equal(b.properties.SESSION_SECRET, secretAfterIssue); // not regenerated on verify
});

test('verifySessionToken_ rejects a tampered payload, a garbage token, and one signed with a different secret', () => {
  const b = backend();
  const token = b.context.issueSessionToken_('a@example.com', 'A');
  const [payloadPart, signaturePart] = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({email: 'attacker@example.com', name: '', exp: Date.now() + 1e9})).toString('base64');
  assert.throws(() => b.context.verifySessionToken_(tamperedPayload + '.' + signaturePart), /invalid/i);
  assert.throws(() => b.context.verifySessionToken_('not-a-real-token'), /invalid/i);
  assert.throws(() => b.context.verifySessionToken_(''), /invalid/i);
  assert.throws(() => b.context.verifySessionToken_(null), /invalid/i);
  // A token signed under a rotated secret (simulating SESSION_SECRET being cleared/changed) must fail.
  b.properties.SESSION_SECRET = 'a-completely-different-secret';
  assert.throws(() => b.context.verifySessionToken_(token), /invalid/i);
});

test('verifySessionToken_ rejects an expired session with a distinct message', () => {
  const b = backend();
  // Forge an already-expired token directly (bypassing issueSessionToken_'s fixed TTL) to test expiry handling in isolation.
  const payloadPart = Buffer.from(JSON.stringify({email: 'a@example.com', name: '', exp: Date.now() - 1000})).toString('base64');
  const signaturePart = Buffer.from(crypto.createHmac('sha256', b.context.getSessionSecret_()).update(payloadPart).digest()).toString('base64');
  assert.throws(() => b.context.verifySessionToken_(payloadPart + '.' + signaturePart), /expired/i);
});

test('resolveIdentity_ prefers a sessionToken over an idToken when both are present, and never calls verifyToken for it', () => {
  const b = backend();
  const token = b.context.issueSessionToken_('session@example.com', 'Session Person');
  let verifyTokenCalls = 0;
  b.context.verifyToken = () => { verifyTokenCalls++; return {email: 'idtoken@example.com', name: 'Wrong', sub: 'x'}; };
  const identity = b.context.resolveIdentity_({sessionToken: token, idToken: 'irrelevant'});
  assert.equal(identity.email, 'session@example.com');
  assert.equal(identity.name, 'Session Person');
  assert.equal(verifyTokenCalls, 0);
});

test('resolveIdentity_ falls back to verifyToken(idToken) when no sessionToken is supplied', () => {
  const b = backend();
  b.context.verifyToken = () => ({email: 'idtoken@example.com', name: 'ID Token Person', sub: 'sub-1'});
  const identity = b.context.resolveIdentity_({idToken: 'a-real-looking-token'});
  assert.equal(identity.email, 'idtoken@example.com');
  assert.equal(identity.name, 'ID Token Person');
  assert.equal(identity.sub, 'sub-1');
});

test('doPost membership issues a sessionToken only when approved, and every other action accepts a valid sessionToken with no Google round trip', () => {
  const b = backend();
  b.context.json = value => value;
  b.context.checkMembership = () => true;
  b.context.getContacts = () => ({});
  b.context.getCompanies = () => [{n: 'Acme'}];
  b.context.getOpportunityProfile = () => ({name: 'Person'});
  b.context.isApproved = () => true;
  let verifyTokenCalls = 0;
  b.context.verifyToken = () => { verifyTokenCalls++; return {email: 'a@example.com', name: 'Person', sub: 'sub'}; };

  const loginResult = b.context.doPost({postData: {contents: JSON.stringify({action: 'membership', includeBootstrap: true, idToken: 'google-token'})}});
  assert.equal(loginResult.approved, true);
  assert.ok(loginResult.sessionToken);
  assert.equal(loginResult.sessionExpiresInMs, 8 * 60 * 60 * 1000);
  assert.equal(verifyTokenCalls, 1);

  // Every later request uses the sessionToken instead - verifyToken (and therefore any call
  // out to Google) is never invoked again.
  const companiesResult = b.context.doPost({postData: {contents: JSON.stringify({action: 'companies', sessionToken: loginResult.sessionToken})}});
  assert.deepEqual(companiesResult.companies, [{n: 'Acme'}]);
  assert.equal(verifyTokenCalls, 1);
});

test('doPost membership does not issue a sessionToken when the account is not approved', () => {
  const b = backend();
  b.context.json = value => value;
  b.context.checkMembership = () => false;
  b.context.verifyToken = () => ({email: 'pending@example.com', name: '', sub: 'sub'});
  const result = b.context.doPost({postData: {contents: JSON.stringify({action: 'membership', includeBootstrap: true, idToken: 'google-token'})}});
  assert.equal(result.approved, false);
  assert.equal(result.sessionToken, undefined);
});

test('doPost rejects an invalid or expired sessionToken the same way it rejects a bad idToken', () => {
  const b = backend();
  b.context.json = value => value;
  const result = b.context.doPost({postData: {contents: JSON.stringify({action: 'companies', sessionToken: 'garbage.garbage'})}});
  assert.match(result.error, /sign in again/i);
});
