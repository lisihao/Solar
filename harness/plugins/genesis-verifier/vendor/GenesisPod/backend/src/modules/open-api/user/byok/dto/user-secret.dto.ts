/**
 * HTTP-facing DTOs for user/secrets endpoints.
 * Re-exported from platform layer to avoid L4 → L1 dependency inversion.
 */
export {
  CreateUserSecretDto,
  UpdateUserSecretDto,
} from "@/modules/platform/credentials/user-owned/user-secrets/dto/user-secret-input.dto";
