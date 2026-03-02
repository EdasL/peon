export interface ProviderStatus {
  connected: boolean;
  userConnected: boolean;
  systemConnected: boolean;
  activeAuthType?: "oauth" | "device-code" | "api-key";
  authMethods?: Array<{
    profileId: string;
    authType: "oauth" | "device-code" | "api-key";
    label: string;
    isPrimary: boolean;
  }>;
}
