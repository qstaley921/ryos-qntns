// §6: ryOS's realtime server (Pusher / local /ws) is gone. Same exports, no
// socket: channels never receive events and the state stays "disconnected".
import type { Channel } from "pusher-js";

type Handler = { bivarianceHack(data?: unknown): void }["bivarianceHack"];

export interface RealtimeChannel {
  name: string;
  bind(eventName: string, handler: Handler): void;
  unbind(eventName?: string, handler?: Handler): void;
}

export interface RealtimeConnection {
  bind(eventName: string, handler: Handler): void;
  unbind(eventName?: string, handler?: Handler): void;
}

export interface RealtimeClient {
  connection: RealtimeConnection;
  subscribe(channelName: string): RealtimeChannel;
  unsubscribe(channelName: string): void;
  channel(channelName: string): RealtimeChannel | undefined;
}

export type RealtimeConnectionState = "connected" | "connecting" | "disconnected";
export type RealtimeConnectionListener = (state: RealtimeConnectionState) => void;
export type PusherChannel = Channel | RealtimeChannel;

const noop = () => {};
const channel = (name: string): RealtimeChannel => ({ name, bind: noop, unbind: noop });
const client: RealtimeClient = {
  connection: { bind: noop, unbind: noop },
  subscribe: channel,
  unsubscribe: noop,
  channel: () => undefined,
};

export const getPusherClient = (): RealtimeClient => client;
export const getRealtimeConnectionState = (): RealtimeConnectionState => "disconnected";
export const getRealtimeConnectionSnapshot = getRealtimeConnectionState;
export const subscribeRealtimeConnection = (_listener: RealtimeConnectionListener) => noop;
export const getRealtimeChannelNames = (): string[] => [];
export const subscribePusherChannel = (name: string): PusherChannel => channel(name);
export const unsubscribePusherChannel = (_name: string): void => {};
