import fs from "fs/promises";
import FormData from "form-data";
import path from "path";
import { zip } from "zip-a-folder";
import axios from "axios";

const API_URL = "https://nekoweb.org/api";

const { NEKOWEB_API_KEY, NEKOWEB_FOLDER, DIRECTORY } = process.env;
const NEKOWEB_COOKIE: string | undefined = process.env.NEKOWEB_COOKIE;
if (!NEKOWEB_API_KEY) throw new Error("API key not found");
if (!NEKOWEB_FOLDER) throw new Error("Folder not found");
if (!DIRECTORY) throw new Error("Directory not found");

interface ILimit {
  limit: number
  remaining: number
  reset: number
}
interface IFileLimitsResponse {
  general: ILimit
  big_uploads: ILimit
  zip: ILimit
}

const genericRequest = async (url: string, options: any): Promise<any> => {
  try {
    const response = await axios({
      url: API_URL + url,
      ...options,
    });
    return response.data;
  } catch (error: any) {
    console.error(
      `Failed to fetch ${url}\n${error.message}`
    );
    throw error;
  }
};

const getLimits = async (type: keyof IFileLimitsResponse) => {
  const response: IFileLimitsResponse = await genericRequest('/files/limits', {
    headers: { Authorization: NEKOWEB_API_KEY }
  })
  return response[type]
}

const uploadToNekoweb = async () => {
  const MAX_CHUNK_SIZE =
    Number(process.env.MAX_CHUNK_SIZE) || 100 * 1024 * 1024;
  const MIN_CHUNK_SIZE = Number(process.env.MIN_CHUNK_SIZE) || 10 * 1024 * 1024;
  const MIN_CHUNKS = Number(process.env.MIN_CHUNKS) || 5;

  console.log("Uploading files to Nekoweb...");

  const bigUploads = await getLimits('big_uploads')
  if (bigUploads.remaining < 1) {
    throw new Error(`Unable to upload to Nekoweb. No more big uploads allowed until ${new Date(bigUploads.reset)}.`)
  }

  // Create an upload session
  const uploadId = await genericRequest("/files/big/create", {
    method: "GET",
    headers: { Authorization: NEKOWEB_API_KEY },
  }).then((data) => data.id);

  console.log("Upload ID:", uploadId);

  // Zip the folder
  const zipPath = path.join(path.dirname(__dirname), `${uploadId}.zip`);
  console.log(zipPath);
  await zip(path.join(path.dirname(__dirname), DIRECTORY), zipPath, {
    destPath: NEKOWEB_FOLDER,
  });

  // Get the file size
  const fileBuffer = await fs.readFile(zipPath);
  const fileSize = fileBuffer.length;
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

  console.log(
    `File Size: ${fileSize} bytes, Chunk Size: ${chunkSize}, Number of Chunks: ${numberOfChunks}`
  );

  let uploadedBytes = 0;

  for (let chunkIndex = 0; chunkIndex < numberOfChunks; chunkIndex++) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, fileSize);
    const chunk = fileBuffer.slice(start, end);

    console.log(`Uploading chunk ${chunkIndex} with size ${chunk.length}...`);

    const formData = new FormData();
    formData.append("id", uploadId);
    formData.append("file", chunk, { filename: `chunk_${chunkIndex}.part` });

    try {
      await genericRequest("/files/big/append", {
        method: "POST",
        headers: {
          ...formData.getHeaders(),
          Authorization: NEKOWEB_API_KEY,
        },
        data: formData,
      });

      console.log(`Chunk ${chunkIndex} uploaded successfully.`);
    } catch (error) {
      console.error(`Error uploading chunk ${chunkIndex}:`, error);
      throw error;
    }

    uploadedBytes += chunk.length;
  }

  console.log(`Uploaded ${uploadedBytes} bytes`);

  const zipLimits = await getLimits('zip')
  if (zipLimits.remaining < 1) {
    throw new Error(`Unable to upload to Nekoweb. No more zip uploads allowed until ${new Date(zipLimits.reset)}.`)
  }

  const fileLimits = await getLimits('general')
  if (fileLimits.remaining < 1) {
    throw new Error(`Unable to upload to Nekoweb. No more file uploads allowed until ${new Date(fileLimits.reset)}.`)
  }

  try {
    await genericRequest("/files/delete", {
      method: "POST",
      headers: {
        Authorization: NEKOWEB_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: `pathname=${NEKOWEB_FOLDER}`,
    });
  } catch (e) {}

  // Finalize the upload
  await genericRequest(`/files/import/${uploadId}`, {
    method: "POST",
    headers: { Authorization: NEKOWEB_API_KEY },
  });

  if (NEKOWEB_COOKIE != null) {
    await genericRequest("/files/edit", {
      method: "POST",
      data: {
        pathname: "/index.html",
        content: `<!-- ${Date.now()} -->`,
      },
      headers: {
        "User-Agent": "deploy2nekoweb build script (please don't ban us)",
        "Content-Type": "multipart/form-data",
        Referer: `https://nekoweb.org/?${encodeURIComponent(
          "deploy2nekoweb build script (please dont ban us)"
        )}`,
        Cookie: `token=${NEKOWEB_COOKIE}`,
      },
    });
    console.log("Sent cookie request.");
  }

  console.log("Upload finalized successfully.");
  
  await fs.rm(zipPath);

  console.log("Upload completed and cleaned up.");
};

// Call the function to perform the upload
uploadToNekoweb().catch((err) => {
  throw new Error(`An error occurred during the upload process: ${err.message}\n\nError info: ${err.stack}`);
});
