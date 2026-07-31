export type SignalingEventType =
  | "CALL_INVITE"
  | "CALL_RINGING"
  | "CALL_ACCEPT"
  | "CALL_REJECT"
  | "CALL_CANCEL"
  | "CALL_END"
  | "CALL_BUSY"
  | "CALL_TIMEOUT"
  | "CALL_FAILED"
  | "SDP_OFFER"
  | "SDP_ANSWER"
  | "ICE_CANDIDATE"
  | "MIC_MUTED"
  | "MIC_UNMUTED"
  | "CAMERA_ENABLED"
  | "CAMERA_DISABLED"
  | "SCREEN_SHARE_STARTED"
  | "SCREEN_SHARE_STOPPED"
  | "NETWORK_QUALITY"
  | "PING"
  | "PONG"
  | "ERROR";

export type NetworkQualityLevel =
  | "excellent"
  | "good"
  | "fair"
  | "poor"
  | "lost"
  | "reconnecting"
  | "disconnected";

export interface IceServerConfig {
  urls: string | string[];
  username?: string | null;
  credential?: string | null;
}

export interface SignalingEvent {
  id?: string;
  type: SignalingEventType;
  call_id?: string | null;
  sender_id?: string | null;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export interface SignalingOutbound {
  type: SignalingEventType;
  call_id?: string | null;
  request_id?: string;
  payload?: Record<string, unknown>;
}
