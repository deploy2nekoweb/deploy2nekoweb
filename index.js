const fs = require("fs")
const formData = new FormData();
const API_KEY = process.env.api_key
const API_URL = "https://nekoweb.org/api"

const localFolder = "/public"
const nekowebFolder = "/public"

const deletePrev = await fetch(`${API_URL}/files/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: API_KEY },
    body: "pathname=/public"
}).then(res => res.text());
console.log(deletePrev)

const createNew = await fetch(`${API_URL}/files/create`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: API_KEY },
    body: "pathname=/public&isFolder=true"
}).then(res => res.text());
console.log(createNew)

const createLargeFile = await fetch(`${API_URL}/files/big/create`, {
  headers: { Authorization: API_KEY },
}).then(res => res.json());
console.log(createLargeFile)
console.log(createLargeFile.id)

fs.readFileSync("./website.zip", (err, zipFile) => {
  if (err) { throw err; }
  formData.append('id', createLargeFile.id);
  formData.append('file', zipFile, { filepath: './website.zip' });
})

const appendChunk = await fetch(`${API_URL}/files/big/append`, { method: "POST", headers: { "Content-Type": "multipart/form-data", Authorization: API_KEY }, body: formData }).then(res => res.text());
console.log(appendChunk)
const importZip = await fetch(`${API_URL}/files/import/${createLargeFile.id}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: API_KEY } }).then(res => res.text());
console.log(importZip)