/**
 * Process Capability Types
 * Defines what a process is allowed to do
 */

export interface ProcessCapabilities {
  /** List of tool IDs this process can invoke */
  grantedTools: string[];
  /** List of skill IDs this process can invoke */
  grantedSkills: string[];
  /** Data access scope (e.g., { userId: "...", collections: [...] }) */
  dataScope: Record<string, unknown> | null;
}

export interface CapabilityCheckResult {
  allowed: boolean;
  reason?: string;
}
