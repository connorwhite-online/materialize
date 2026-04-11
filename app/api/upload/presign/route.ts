import { auth } from "@clerk/nextjs/server";
import { generateUploadUrl } from "@/lib/storage";
import { nanoid } from "nanoid";
import { fileExtensionToFormat, MAX_FILE_SIZE } from "@/lib/validations/file";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { filename, contentType, fileSize } = body as {
    filename: string;
    contentType: string;
    fileSize: number;
  };

  if (!filename) {
    return Response.json({ error: "Filename is required" }, { status: 400 });
  }

  if (fileSize > MAX_FILE_SIZE) {
    return Response.json(
      { error: "File exceeds 200MB limit" },
      { status: 400 }
    );
  }

  const format = fileExtensionToFormat(filename);
  if (!format) {
    return Response.json(
      { error: "Unsupported file format. Accepted: STL, OBJ, 3MF, STEP, AMF" },
      { status: 400 }
    );
  }

  const storageKey = `uploads/${userId}/${nanoid()}/${filename}`;
  const uploadUrl = await generateUploadUrl(
    storageKey,
    contentType || "application/octet-stream"
  );

  return Response.json({ uploadUrl, storageKey, format });
}
