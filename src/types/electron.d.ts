import type {
  ApiRequest,
  AuthUser,
  LocalPreferences,
  TransportResult,
} from "./api";

declare global {
  interface Window {
    chatter?: {
      request<T>(request: ApiRequest): Promise<TransportResult<T>>;
      restoreSession(): Promise<TransportResult<AuthUser | null>>;
      logout(): Promise<TransportResult<void>>;
      uploadAvatar(
        file: ArrayBuffer,
        name: string,
        type: string,
      ): Promise<TransportResult<unknown>>;
      uploadMedia(
        path: string,
        file: ArrayBuffer,
        name: string,
        type: string,
        field?: string,
      ): Promise<TransportResult<unknown>>;
      getAccessToken(): Promise<TransportResult<string | null>>;
      getPreferences(): Promise<LocalPreferences>;
      setPreferences(
        patch: Partial<LocalPreferences>,
      ): Promise<LocalPreferences>;
      notify(payload: {
        title: string;
        body?: string;
        silent?: boolean;
      }): Promise<boolean>;
      streamAIConversation(
        payload: {
          requestId: string;
          conversationId: string;
          messages: Array<{
            role: "user" | "assistant";
            content: string;
          }>;
        },
        onToken: (token: string) => void,
      ): Promise<
        TransportResult<{
          completed: boolean;
          model: string;
        }>
      >;
      cancelAIConversation(requestId: string): void;
      onMenuAction(handler: (action: string) => void): () => void;
    };
  }
}

export {};
