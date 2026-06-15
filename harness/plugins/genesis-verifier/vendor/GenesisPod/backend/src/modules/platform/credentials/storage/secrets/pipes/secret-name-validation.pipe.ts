/**
 * H1 Fix: Secret Name Parameter Validation
 * Validates that secret name matches expected format to prevent injection attacks
 */

import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";

/**
 * Validation pipe for secret name parameter
 * Ensures the name follows the expected pattern: lowercase alphanumeric with hyphens
 */
@Injectable()
export class SecretNameValidationPipe implements PipeTransform<string, string> {
  private readonly validPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  private readonly maxLength = 100;

  transform(value: string): string {
    if (!value || typeof value !== "string") {
      throw new BadRequestException("Secret name is required");
    }

    const trimmed = value.trim().toLowerCase();

    if (trimmed.length === 0) {
      throw new BadRequestException("Secret name cannot be empty");
    }

    if (trimmed.length > this.maxLength) {
      throw new BadRequestException(
        `Secret name cannot exceed ${this.maxLength} characters`,
      );
    }

    if (!this.validPattern.test(trimmed)) {
      throw new BadRequestException(
        "Secret name must be lowercase alphanumeric with hyphens only, " +
          "cannot start or end with a hyphen",
      );
    }

    // Check for suspicious patterns that might indicate injection attempts
    // Note: Double hyphens (--) are allowed as they're common in naming conventions
    // H1 Fix: Use trimmed value for suspicious pattern check (not original value)
    const suspiciousPatterns = [
      /\.\./, // path traversal
      /__/, // double underscore
      /[<>'";&|]/, // common injection chars
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(trimmed)) {
        throw new BadRequestException(
          "Secret name contains invalid characters",
        );
      }
    }

    return trimmed;
  }
}
