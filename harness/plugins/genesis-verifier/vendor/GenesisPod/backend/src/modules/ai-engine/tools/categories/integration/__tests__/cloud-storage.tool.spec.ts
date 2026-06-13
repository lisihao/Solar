/**
 * Unit tests for CloudStorageTool
 */

import { CloudStorageTool } from "../cloud-storage.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
// ============================================================================

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((input) => ({ _type: "PutObjectCommand", input })),
  GetObjectCommand: jest.fn((input) => ({ _type: "GetObjectCommand", input })),
  ListObjectsV2Command: jest.fn((input) => ({
    _type: "ListObjectsV2Command",
    input,
  })),
  DeleteObjectCommand: jest.fn((input) => ({
    _type: "DeleteObjectCommand",
    input,
  })),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest
    .fn()
    .mockResolvedValue(
      "https://signed-url.example.com/file.txt?X-Amz-Signature=abc",
    ),
}));

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MockedS3Client = S3Client as jest.MockedClass<typeof S3Client>;
const mockedGetSignedUrl = getSignedUrl as jest.Mock;

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "cloud-storage",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

const s3Config = {
  region: "us-east-1",
  bucket: "test-bucket",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

const minioConfig = {
  endpoint: "http://localhost:9000",
  bucket: "minio-bucket",
  accessKey: "minioadmin",
  secretKey: "minioadmin",
};

// ============================================================================
// Test suite
// ============================================================================

describe("CloudStorageTool", () => {
  let tool: CloudStorageTool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({});
    MockedS3Client.mockImplementation(
      () => ({ send: mockS3Send }) as unknown as S3Client,
    );
    mockedGetSignedUrl.mockResolvedValue(
      "https://signed-url.example.com/file.txt?X-Amz-Signature=abc",
    );
    tool = new CloudStorageTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid upload operation", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "upload",
          config: s3Config,
          uploadParams: {
            files: [
              { key: "test.txt", content: "aGVsbG8=", contentType: "base64" },
            ],
          },
        }),
      ).toBe(true);
    });

    it("should return true for a valid download operation", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "download",
          config: s3Config,
          downloadParams: { keys: ["test.txt"] },
        }),
      ).toBe(true);
    });

    it("should return true for a valid list operation", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "list",
          config: s3Config,
        }),
      ).toBe(true);
    });

    it("should return true for a valid delete operation", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "delete",
          config: s3Config,
          deleteParams: { keys: ["test.txt"] },
        }),
      ).toBe(true);
    });

    it("should return false for an invalid provider", () => {
      expect(
        tool.validateInput({
          provider: "invalid" as "s3",
          operation: "list",
          config: s3Config,
        }),
      ).toBe(false);
    });

    it("should return false for an invalid operation", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "copy" as "upload",
          config: s3Config,
        }),
      ).toBe(false);
    });

    it("should return false for upload without files", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "upload",
          config: s3Config,
          uploadParams: { files: [] },
        }),
      ).toBe(false);
    });

    it("should return false for download without keys", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "download",
          config: s3Config,
          downloadParams: { keys: [] },
        }),
      ).toBe(false);
    });

    it("should return false for delete without keys", () => {
      expect(
        tool.validateInput({
          provider: "s3",
          operation: "delete",
          config: s3Config,
          deleteParams: { keys: [] },
        }),
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Upload
  // --------------------------------------------------------------------------

  describe("upload", () => {
    it("should call PutObjectCommand and return fileUrl in uploadResult", async () => {
      mockS3Send.mockResolvedValueOnce({});
      const context = createMockContext();
      const base64Content = Buffer.from("hello world").toString("base64");

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "upload",
          config: s3Config,
          uploadParams: {
            files: [
              {
                key: "reports/file.txt",
                content: base64Content,
                contentType: "base64",
                mimeType: "text/plain",
              },
            ],
          },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("upload");
      expect(PutObjectCommand).toHaveBeenCalledTimes(1);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(result.data?.uploadResult?.uploaded).toHaveLength(1);
      expect(result.data?.uploadResult?.uploaded[0].key).toBe(
        "reports/file.txt",
      );
    });

    it("should report failed files on partial failure", async () => {
      mockS3Send
        .mockResolvedValueOnce({}) // first file succeeds
        .mockRejectedValueOnce(new Error("Access denied")); // second file fails

      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "upload",
          config: s3Config,
          uploadParams: {
            files: [
              { key: "file1.txt", content: "aGVsbG8=", contentType: "base64" },
              { key: "file2.txt", content: "d29ybGQ=", contentType: "base64" },
            ],
          },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.uploadResult?.uploaded).toHaveLength(1);
      expect(result.data?.uploadResult?.failed).toHaveLength(1);
      expect(result.data?.uploadResult?.failed?.[0].key).toBe("file2.txt");
    });
  });

  // --------------------------------------------------------------------------
  // Download (presigned URL)
  // --------------------------------------------------------------------------

  describe("download", () => {
    it("should call GetObjectCommand and return presigned URL in downloadResult", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "download",
          config: s3Config,
          downloadParams: { keys: ["reports/file.txt"], expiresIn: 3600 },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("download");
      expect(GetObjectCommand).toHaveBeenCalledTimes(1);
      expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
      expect(result.data?.downloadResult?.files).toHaveLength(1);
      expect(result.data?.downloadResult?.files[0].presignedUrl).toContain(
        "https://signed-url.example.com",
      );
    });

    it("should use custom expiresIn when provided", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          provider: "s3",
          operation: "download",
          config: s3Config,
          downloadParams: { keys: ["file.txt"], expiresIn: 7200 },
        },
        context,
      );

      expect(mockedGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ expiresIn: 7200 }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  describe("list", () => {
    it("should call ListObjectsV2Command and return files array", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: "file1.txt",
            Size: 1024,
            LastModified: new Date("2024-01-01"),
            ETag: "etag1",
            StorageClass: "STANDARD",
          },
          {
            Key: "file2.txt",
            Size: 2048,
            LastModified: new Date("2024-01-02"),
            ETag: "etag2",
            StorageClass: "STANDARD",
          },
        ],
        IsTruncated: false,
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "list",
          config: s3Config,
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("list");
      expect(ListObjectsV2Command).toHaveBeenCalledTimes(1);
      expect(result.data?.listResult?.objects).toHaveLength(2);
      expect(result.data?.listResult?.totalCount).toBe(2);
      expect(result.data?.listResult?.hasMore).toBe(false);
    });

    it("should include nextPageToken when there are more results", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: "file.txt", Size: 100, LastModified: new Date() }],
        IsTruncated: true,
        NextContinuationToken: "next-token-abc",
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "list",
          config: s3Config,
        },
        context,
      );

      expect(result.data?.listResult?.hasMore).toBe(true);
      expect(result.data?.listResult?.nextPageToken).toBe("next-token-abc");
    });
  });

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  describe("delete", () => {
    it("should call DeleteObjectCommand and return deleted keys", async () => {
      mockS3Send.mockResolvedValue({});
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "delete",
          config: s3Config,
          deleteParams: { keys: ["file1.txt", "file2.txt"] },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe("delete");
      expect(DeleteObjectCommand).toHaveBeenCalledTimes(2);
      expect(result.data?.deleteResult?.deleted).toEqual([
        "file1.txt",
        "file2.txt",
      ]);
    });

    it("should throw (return success=false) on delete error without force flag", async () => {
      mockS3Send.mockRejectedValueOnce(new Error("NoSuchKey"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "delete",
          config: s3Config,
          deleteParams: { keys: ["missing.txt"] },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("NoSuchKey");
    });
  });

  // --------------------------------------------------------------------------
  // Unsupported provider (GCS / Azure)
  // --------------------------------------------------------------------------

  describe("unsupported provider", () => {
    it("should return success=false with error message for GCS provider", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "gcs",
          operation: "list",
          config: { projectId: "my-project", bucket: "my-bucket" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("gcs");
      expect(result.data?.error?.toLowerCase()).toContain("not yet integrated");
    });

    it("should return success=false with error message for Azure provider", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "azure",
          operation: "list",
          config: { accountName: "myaccount", container: "mycontainer" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("azure");
    });
  });

  // --------------------------------------------------------------------------
  // S3 send throws
  // --------------------------------------------------------------------------

  describe("S3 send throws", () => {
    it("should return success=false with error when S3 send throws", async () => {
      mockS3Send.mockRejectedValueOnce(new Error("S3 credentials invalid"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "s3",
          operation: "list",
          config: s3Config,
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("S3 credentials invalid");
    });
  });

  // --------------------------------------------------------------------------
  // MinIO endpoint
  // --------------------------------------------------------------------------

  describe("MinIO", () => {
    it("should use MinIO endpoint when provider=minio", async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [],
        IsTruncated: false,
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          provider: "minio",
          operation: "list",
          config: minioConfig,
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      // Verify S3Client was created with the MinIO endpoint
      expect(MockedS3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: minioConfig.endpoint,
          forcePathStyle: true,
        }),
      );
    });

    it("should pass MinIO credentials correctly", async () => {
      mockS3Send.mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const context = createMockContext();

      await tool.execute(
        {
          provider: "minio",
          operation: "list",
          config: minioConfig,
        },
        context,
      );

      expect(MockedS3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({
            accessKeyId: minioConfig.accessKey,
            secretAccessKey: minioConfig.secretKey,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // S3 credentials
  // --------------------------------------------------------------------------

  describe("S3 credentials", () => {
    it("should pass explicit S3 credentials when provided", async () => {
      mockS3Send.mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      const context = createMockContext();

      await tool.execute(
        {
          provider: "s3",
          operation: "list",
          config: s3Config,
        },
        context,
      );

      expect(MockedS3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: "us-east-1",
          credentials: expect.objectContaining({
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("cloud-storage");
      expect(tool.category).toBe("integration");
    });
  });
});
