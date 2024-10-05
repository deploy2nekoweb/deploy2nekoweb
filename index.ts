import fs from "fs/promises";
import FormData from "form-data";
import path from "path";
import { zip } from "zip-a-folder";
import axios from "axios";

const API_URL = "https://nekoweb.org/api";
const {
  NEKOWEB_API_KEY,
  NEKOWEB_FOLDER,
  DIRECTORY,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MIN_CHUNKS,
} = process.env;
const NEKOWEB_COOKIE: string | undefined = process.env.NEKOWEB_COOKIE || undefined;
console.log(btoa(JSON.stringify(NEKOWEB_COOKIE)))

if (!NEKOWEB_API_KEY) throw new Error("API key not found");
if (!NEKOWEB_FOLDER) throw new Error("Folder not found");
if (!DIRECTORY) throw new Error("Directory not found");

interface ILimit {
  limit: number;
  remaining: number;
  reset: number;
}

interface IFileLimitsResponse {
  general: ILimit;
  big_uploads: ILimit;
  zip: ILimit;
}

const genericRequest = async (url: string, options: any): Promise<any> => {
  try {
    const response = await axios({
      url: API_URL + url,
      ...options,
    });
    return response.data;
  } catch (error: any) {
    console.error(`Failed to fetch ${url}\n${error.message}`);
    throw error;
  }
};

const getLimits = async (type: keyof IFileLimitsResponse) => {
  const response: IFileLimitsResponse = await genericRequest("/files/limits", {
    headers: { Authorization: NEKOWEB_API_KEY }
  });
  return response[type];
};

const sleepUntil = (time: number) => {
  const now = Date.now();
  if (now >= time) return;
  return new Promise((resolve) => setTimeout(resolve, time - now));
};

const createUploadSession = async () =>
  await genericRequest("/files/big/create", {
    method: "GET",
    headers: getCreds(),
  }).then((data) => data.id);

const zipDirectory = async (uploadId: string) => {
  const zipPath = path.join(path.dirname(__dirname), `${uploadId}.zip`);
  await zip(path.join(path.dirname(__dirname), DIRECTORY), zipPath, {
    destPath: NEKOWEB_FOLDER,
  });
  return zipPath;
};

const getCreds = () => {
  if (NEKOWEB_COOKIE) return {
      Referer: `https://nekoweb.org/?${encodeURIComponent(
        "deploy2nekoweb build script (please dont ban us)"
      )}`,
      Cookie: `token=${NEKOWEB_COOKIE}`,
    };
  return { Authorization: NEKOWEB_API_KEY };
};

const calculateChunks = (fileSize: number) => {
  const maxChunkSize = Number(MAX_CHUNK_SIZE) || 100 * 1024 * 1024;
  const minChunkSize = Number(MIN_CHUNK_SIZE) || 10 * 1024 * 1024;
  const minChunks = Number(MIN_CHUNKS) || 5;

  let numberOfChunks = Math.ceil(fileSize / maxChunkSize);
  let chunkSize = Math.ceil(fileSize / numberOfChunks);

  if (chunkSize < minChunkSize) {
    chunkSize = minChunkSize;
    numberOfChunks = Math.ceil(fileSize / chunkSize);
  }

  if (numberOfChunks < minChunks) {
    numberOfChunks = minChunks;
    chunkSize = Math.ceil(fileSize / numberOfChunks);
  }

  return { chunkSize, numberOfChunks };
};

const uploadChunks = async (
  uploadId: string,
  fileBuffer: Buffer,
  chunkSize: number,
  numberOfChunks: number
) => {
  let uploadedBytes = 0;

  for (let chunkIndex = 0; chunkIndex < numberOfChunks; chunkIndex++) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, fileBuffer.length);
    const chunk = fileBuffer.slice(start, end);

    const formData = new FormData();
    formData.append("id", uploadId);
    formData.append("file", chunk, { filename: `chunk_${chunkIndex}.part` });

    try {
      await genericRequest("/files/big/append", {
        method: "POST",
        headers: {
          ...formData.getHeaders(),
          ...getCreds(),
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

  return uploadedBytes;
};

const getCSRFToken = async () => {
  const username = await genericRequest("/site/info", {
    method: "GET",
    headers: getCreds(),
  }).then((data) => data.username);

  const res = await genericRequest("/csrf", {
    method: "GET",
    headers: {
      Origin: "https://nekoweb.org",
      Host: "nekoweb.org",
      "User-Agent": "deploy2nekoweb build script (please don't ban us)",
      Referer: `https://nekoweb.org/?${encodeURIComponent(
        "deploy2nekoweb build script (please dont ban us)"
      )}`,
      Cookie: `token=${NEKOWEB_COOKIE}`,
    },
  });

  return [res, username];
};

const finalizeUpload = async (uploadId: string) => {
  await genericRequest(`/files/import/${uploadId}`, {
    method: "POST",
    headers: { Authorization: NEKOWEB_API_KEY },
  });

  if (!NEKOWEB_COOKIE) return;
  const [csrfToken, username] = await getCSRFToken();

  await genericRequest("/files/edit", {
    method: "POST",
    data: {
      pathname: "/index.html",
      content: `<!-- ${Date.now()} -->`,
      csrf: csrfToken,
      site: username,
    },
    headers: {
      Origin: "https://nekoweb.org",
      Host: "nekoweb.org",
      "User-Agent": "deploy2nekoweb build script (please don't ban us)",
      "Content-Type": "multipart/form-data",
      Referer: `https://nekoweb.org/?${encodeURIComponent(
        "deploy2nekoweb build script (please dont ban us)"
      )}`,
      Cookie: `token=${NEKOWEB_COOKIE}`,
    },
  });
  console.log("Sent cookie request.");
};

const cleanUp = async (zipPath: string) => {
  await fs.rm(zipPath);
  console.log("Upload completed and cleaned up.");
};

const uploadToNekoweb = async () => {
  console.log("Uploading files to Nekoweb...");

  let bigUploadLimits = await getLimits("big_uploads");
  if (bigUploadLimits.remaining < 1) {
    await sleepUntil(bigUploadLimits.reset);
  }

  const uploadId = await createUploadSession();
  console.log("Upload ID:", uploadId);

  const zipPath = await zipDirectory(uploadId);
  console.log(zipPath);

  const fileBuffer = await fs.readFile(zipPath);
  const fileSize = fileBuffer.length;
  const { chunkSize, numberOfChunks } = calculateChunks(fileSize);

  console.log(
    `File Size: ${fileSize} bytes, Chunk Size: ${chunkSize}, Number of Chunks: ${numberOfChunks}`
  );

  const uploadedBytes = await uploadChunks(
    uploadId,
    fileBuffer,
    chunkSize,
    numberOfChunks
  );
  console.log(`Uploaded ${uploadedBytes} bytes`);

  bigUploadLimits = await getLimits("big_uploads");
  if (bigUploadLimits.remaining < 1) {
    await sleepUntil(bigUploadLimits.reset);
  }

  const zipLimits = await getLimits("zip");
  if (zipLimits.remaining < 1) {
    await sleepUntil(zipLimits.reset);
  }

  const fileLimits = await getLimits("general");
  if (fileLimits.remaining < 1) {
    await sleepUntil(fileLimits.reset);
  }

  try {
    await genericRequest("/files/delete", {
      method: "POST",
      headers: {
        ...getCreds(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: `pathname=${NEKOWEB_FOLDER}`,
    });
  } catch (e) {}

  await finalizeUpload(uploadId);
  await cleanUp(zipPath);
};

uploadToNekoweb().catch((err) => {
  console.error(
    `An error occurred during the upload process: ${err.message}\n\nError info: ${err.stack}`
  );
});
