import fs from 'fs'
import FormData from 'form-data';
import path from 'path'
import { zip } from 'zip-a-folder'

const API_URL = "https://nekoweb.org/api"

const { NEKOWEB_API_KEY, NEKOWEB_FOLDER, DIRECTORY } = process.env
if (!NEKOWEB_API_KEY) throw new Error("API key not found")
if (!NEKOWEB_FOLDER) throw new Error("Folder not found")
if (!DIRECTORY) throw new Error("Directory not found")

const MAX_CHUNK_SIZE = Number(process.env.MAX_CHUNK_SIZE) || 100 * 1024 * 1024;
const MIN_CHUNK_SIZE = Number(process.env.MIN_CHUNK_SIZE) || 10 * 1024 * 1024;
const MIN_CHUNKS = Number(process.env.MIN_CHUNKS) || 5;

const localFolder = "/public"
const nekowebFolder = "/public"

console.log("Uploading files to Nekoweb...")

const genericRequest = async (url: string, options: RequestInit): Promise<Response> => {
  const response = await fetch(API_URL + url, options)
  if (!response.ok) throw new Error(`Failed to fetch ${url}`)
  return response
}

const uploadId = await genericRequest("/files/big/create", {
  headers: { Authorization: NEKOWEB_API_KEY }
}).then(res => res.json()).then(data => data.id)

console.log("Upload ID:", uploadId)

const fileSize = await fs.promises.stat(path.join(__dirname, DIRECTORY)).then(stats => stats.size);
let numberOfChunks = Math.ceil(fileSize / MAX_CHUNK_SIZE);
let chunkSize = Math.ceil(fileSize / numberOfChunks);

if (chunkSize < MIN_CHUNK_SIZE) {
  chunkSize = MIN_CHUNK_SIZE;
  numberOfChunks = Math.ceil(fileSize / chunkSize);
}

if (numberOfChunks < MIN_CHUNKS) {
  numberOfChunks = MIN_CHUNKS;
  chunkSize = Math.ceil(fileSize / numberOfChunks);
}

console.log(chunkSize)

let uploadedBytes = 0

const uuid = crypto.randomUUID()
await zip(path.join(__dirname, DIRECTORY), `${uuid}.zip`)
const stream = fs.createReadStream(path.join(__dirname, `${uuid}.zip`), { highWaterMark: chunkSize });
let chunkIndex = 0;

for await (const chunk of stream) {
  const formData = new FormData();
  formData.append('id', uploadId);
  formData.append('file', chunk, { filename: `chunk_${chunkIndex}` });

  await genericRequest("/files/big/append", {
    method: 'POST',
    headers: {
      ...formData.getHeaders(),
      Authorization: NEKOWEB_API_KEY
    },
    body: formData.getBuffer()
  })

  console.log(chunk)

  uploadedBytes += chunk.length
  chunkIndex++
}

console.log("Uploaded", uploadedBytes, "bytes")

// do ur stuff max

fs.rmSync(path.join(__dirname, `${uuid}.zip`))