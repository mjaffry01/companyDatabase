# Contact address integration

The frontend now sends `address` in the existing contact POST. Jobfinder's contacts tab uses:

`A Company | B Name | C Phone | D Email | E Timestamp | F Address`

The deployed Apps Script source is not in this repository. Adding the header alone does not make the existing script save the new field.

In the existing contact-saving handler, extend its existing row write to include the parsed request's address as the sixth value. Preserve the handler's existing validation, duplicate checks and response behavior. For example, if the parsed request is called `data` and the contacts sheet is called `sheet`:

```js
const address = String(data.address || '').trim().slice(0, 500);
sheet.appendRow([
  data.company, data.name, data.phone, data.email, new Date(),
  address.startsWith('=') ? "'" + address : address
]);
```

Replace the existing append operation; do not add a second append operation.

In the existing contacts GET handler, read column F as well as A:E, and include `address: String(row[5] || '')` in each returned contact object. Keep the first five field mappings unchanged. Skip the actual header row, not a contact record.

Save the script and update its existing Web App deployment to a new version so the current frontend URL continues working. Then verify that a newly entered address is present in column F and in the contacts GET response after refresh.
