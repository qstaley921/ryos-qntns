/**
 * First-party analytics SDK and centralized analytics event constants.
 *
 * §6: the server is gone, so `track` is a no-op; the constants stay for
 * call sites.
 */

// Core application events
export const APP_ANALYTICS = {
  // App lifecycle
  APP_LAUNCH: "app:launch",
  APP_REOPEN: "app:reopen",
  APP_FOCUS: "app:focus",
  APP_CLOSE: "app:close",
  APP_MINIMIZE: "app:minimize",
  APP_RESTORE: "app:restore",
  APP_EXPOSE: "app:expose",
  AI_MODEL_CHANGE: "app:ai_model_change",
  APP_CRASH: "app:crash",
  DESKTOP_CRASH: "desktop:crash",
  
  // User lifecycle
  USER_CREATE: "user:create",
  USER_LOGIN_PASSWORD: "user:login_password",
  USER_LOGIN_TOKEN: "user:login_token",
  USER_LOGOUT: "user:logout",
} as const;

// System / runtime events (prefetch, offline, updates)
export const SYSTEM_ANALYTICS = {
  PREFETCH_START: "system:prefetch_start",
  PREFETCH_COMPLETE: "system:prefetch_complete",
  PREFETCH_SKIPPED_NETWORK: "system:prefetch_skipped_network",
  OFFLINE_CHUNK_FAILURE: "system:offline_chunk_failure",
  UPDATE_APPLIED: "system:update_applied",
} as const;

// Chat-specific events (existing)
export const CHAT_ANALYTICS = {
  TEXT_MESSAGE: "chats:text",
  VOICE_MESSAGE: "chats:voice",
  NUDGE: "chats:nudge",
  STOP_GENERATION: "chats:stop",
  ROOM_CREATE: "chats:room_create",
  ROOM_DELETE: "chats:room_delete",
  ROOM_SWITCH: "chats:room_switch",
} as const;

// Internet Explorer events (existing)
export const IE_ANALYTICS = {
  NAVIGATION_START: "internet-explorer:navigation_start",
  NAVIGATION_ERROR: "internet-explorer:navigation_error",
  NAVIGATION_SUCCESS: "internet-explorer:navigation_success",
  GENERATION_START: "internet-explorer:generation_start",
  GENERATION_SUCCESS: "internet-explorer:generation_success",
  GENERATION_ERROR: "internet-explorer:generation_error",
} as const;

// Terminal events (existing)
export const TERMINAL_ANALYTICS = {
  AI_COMMAND: "terminal:ai_command",
  CHAT_START: "terminal:chat_start",
  CHAT_EXIT: "terminal:chat_exit",
  CHAT_CLEAR: "terminal:chat_clear",
} as const;

// iPod events
export const IPOD_ANALYTICS = {
  SONG_PLAY: "ipod:song_play",
} as const;

// Applet Viewer events
export const APPLET_ANALYTICS = {
  INSTALL: "applet:install",
  UPDATE: "applet:update",
  VIEW: "applet:view",
} as const;

export const FINDER_ANALYTICS = {
  FILE_OPEN: "finder:file_open",
  FILE_SAVE: "finder:file_save",
  FILE_MOVE: "finder:file_move",
  FILE_RENAME: "finder:file_rename",
  FOLDER_CREATE: "finder:folder_create",
  MOVE_TO_TRASH: "finder:move_to_trash",
  RESTORE_FROM_TRASH: "finder:restore_from_trash",
  EMPTY_TRASH: "finder:empty_trash",
} as const;

export const TEXTEDIT_ANALYTICS = {
  NEW_DOCUMENT: "textedit:new_document",
  SAVE: "textedit:save",
  SAVE_AS: "textedit:save_as",
  IMPORT: "textedit:import",
  EXPORT: "textedit:export",
  TRANSCRIBE: "textedit:transcribe",
} as const;

export const PAINT_ANALYTICS = {
  NEW_IMAGE: "paint:new_image",
  SAVE: "paint:save",
  IMPORT: "paint:import",
  EXPORT: "paint:export",
  TOOL_SELECT: "paint:tool_select",
  FILTER_APPLY: "paint:filter_apply",
  CLEAR: "paint:clear",
} as const;

export const PHOTO_BOOTH_ANALYTICS = {
  CAPTURE: "photo-booth:capture",
  BURST_CAPTURE: "photo-booth:burst_capture",
  EXPORT: "photo-booth:export",
  CAMERA_CHANGE: "photo-booth:camera_change",
  EFFECT_CHANGE: "photo-booth:effect_change",
} as const;

export const MINESWEEPER_ANALYTICS = {
  NEW_GAME: "minesweeper:new_game",
  WIN: "minesweeper:win",
  LOSS: "minesweeper:loss",
  FLAG: "minesweeper:flag",
} as const;

export const MEDIA_ANALYTICS = {
  SONG_PLAY: "media:song_play",
  VIDEO_PLAY: "media:video_play",
  VIDEO_ADD: "media:video_add",
  SHARE: "media:share",
  FULLSCREEN: "media:fullscreen",
  TV_CHANNEL_CREATE: "tv:channel_create",
  TV_CHANNEL_TUNE: "tv:channel_tune",
} as const;

export const WINAMP_ANALYTICS = {
  LOAD: "winamp:load",
  PLAY: "winamp:play",
  PAUSE: "winamp:pause",
  STOP: "winamp:stop",
  NEXT: "winamp:next",
  PREVIOUS: "winamp:previous",
  SKIN_CHANGE: "winamp:skin_change",
  SHUFFLE_TOGGLE: "winamp:shuffle_toggle",
  REPEAT_TOGGLE: "winamp:repeat_toggle",
} as const;

export const LISTEN_ANALYTICS = {
  SESSION_CREATE: "listen:session_create",
  SESSION_JOIN: "listen:session_join",
  SESSION_LEAVE: "listen:session_leave",
  REACTION: "listen:reaction",
  REMOTE_COMMAND: "listen:remote_command",
  TRANSFER_HOST: "listen:transfer_host",
  ASSIGN_DJ: "listen:assign_dj",
} as const;

export const SETTINGS_ANALYTICS = {
  THEME_CHANGE: "settings:theme_change",
  LANGUAGE_CHANGE: "settings:language_change",
  TIMEZONE_CHANGE: "settings:timezone_change",
  DISPLAY_MODE_CHANGE: "settings:display_mode_change",
  WALLPAPER_CHANGE: "settings:wallpaper_change",
  SHADER_TOGGLE: "settings:shader_toggle",
  SHADER_TYPE_CHANGE: "settings:shader_type_change",
  SCREENSAVER_CHANGE: "settings:screensaver_change",
  RESET: "settings:reset",
} as const;

export const CALENDAR_ANALYTICS = {
  EVENT_CREATE: "calendar:event_create",
  EVENT_UPDATE: "calendar:event_update",
  EVENT_DELETE: "calendar:event_delete",
  IMPORT: "calendar:import",
  EXPORT: "calendar:export",
  VIEW_CHANGE: "calendar:view_change",
} as const;

export const CONTACTS_ANALYTICS = {
  CONTACT_CREATE: "contacts:contact_create",
  CONTACT_UPDATE: "contacts:contact_update",
  CONTACT_DELETE: "contacts:contact_delete",
  IMPORT: "contacts:import",
  EXPORT: "contacts:export",
  MY_CARD_SET: "contacts:my_card_set",
} as const;

export const MAPS_ANALYTICS = {
  SEARCH: "maps:search",
  PLACE_SELECT: "maps:place_select",
  FAVORITE_TOGGLE: "maps:favorite_toggle",
  HOME_WORK_SET: "maps:home_work_set",
  HOME_WORK_UNSET: "maps:home_work_unset",
  DIRECTIONS: "maps:directions",
  YOUBIKE_DIRECTIONS: "maps:youbike_directions",
} as const;

export const AIRDROP_ANALYTICS = {
  START: "airdrop:start",
  STOP: "airdrop:stop",
  DISCOVER: "airdrop:discover",
  SEND: "airdrop:send",
  RESPOND: "airdrop:respond",
} as const;

export type AnalyticsPrimitive = string | number | boolean | null;

export type AnalyticsProperties = Record<
  string,
  AnalyticsPrimitive | undefined
>;

// §6: ryOS's analytics server is gone; events are dropped, nothing is sent.
export function track(_name: string, _properties?: AnalyticsProperties): void {}
export async function flushAnalytics(_preferBeacon = false): Promise<void> {}
export function trackPageView(_path?: string): void {}
export function initializeAnalytics(): void {}

export function getTextAnalytics(text: string): AnalyticsProperties {
  const length = text.length;
  const textLengthBucket =
    length === 0
      ? "empty"
      : length <= 20
        ? "1-20"
        : length <= 80
          ? "21-80"
          : length <= 240
            ? "81-240"
            : "241+";
  return {
    textLength: length,
    textLengthBucket,
    hasUrl: /https?:\/\/|www\./i.test(text),
    hasMention: /(^|\s)@[a-z0-9_-]+/i.test(text),
  };
}

export function normalizeUrlForAnalytics(input: string): AnalyticsProperties {
  try {
    const url = new URL(
      input.startsWith("http") ? input : `https://${input}`
    );
    const pathParts = url.pathname.split("/").filter(Boolean);
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.hostname.slice(0, 120),
      pathDepth: pathParts.length,
      pathTop: pathParts[0]?.slice(0, 60) || "",
    };
  } catch {
    return {
      protocol: "unknown",
      host: "invalid",
      pathDepth: 0,
      pathTop: "",
    };
  }
}

// Type helpers for analytics event names
export type AppAnalyticsEvent = typeof APP_ANALYTICS[keyof typeof APP_ANALYTICS];
export type ChatAnalyticsEvent = typeof CHAT_ANALYTICS[keyof typeof CHAT_ANALYTICS];
export type IEAnalyticsEvent = typeof IE_ANALYTICS[keyof typeof IE_ANALYTICS];
export type TerminalAnalyticsEvent = typeof TERMINAL_ANALYTICS[keyof typeof TERMINAL_ANALYTICS];
export type IpodAnalyticsEvent = typeof IPOD_ANALYTICS[keyof typeof IPOD_ANALYTICS];
export type AppletAnalyticsEvent = typeof APPLET_ANALYTICS[keyof typeof APPLET_ANALYTICS];
