import {
  IsArray,
  IsString,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
  MaxLength,
} from "class-validator";

/**
 * DTO for batch delete operation
 */
export class BatchDeleteDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: "At least one content ID is required" })
  @ArrayMaxSize(100, { message: "Maximum 100 items can be deleted at once" })
  ids!: string[];
}

/**
 * DTO for batch publish operation
 */
export class BatchPublishDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: "At least one content ID is required" })
  @ArrayMaxSize(50, { message: "Maximum 50 items can be published at once" })
  ids!: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  connectionId!: string;
}

/**
 * Response for batch operations
 */
export interface BatchOperationResult {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  errors?: Array<{
    id: string;
    error: string;
  }>;
}
