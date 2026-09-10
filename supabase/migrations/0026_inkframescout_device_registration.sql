-- InkframeScout cross-platform support: real device/browser metadata on
-- each connection ("ScoutDevice" in the spec) — reuses the existing
-- extension_connections table rather than a new one, since a connection
-- already IS one device's credential. Populated honestly from the
-- connecting browser's own navigator.userAgent at connect time
-- (extension/lib/browser-capabilities.js's detectDeviceInfo()), never
-- guessed server-side. extension_version is refreshed on every real
-- capture too, so an upgraded extension's version shows up without the
-- user having to reconnect. See "Cross-Platform Support" in the root
-- README.md.

alter table public.extension_connections add column device_type text check (device_type in ('desktop', 'mobile'));
alter table public.extension_connections add column browser_name text;
alter table public.extension_connections add column browser_version text;
alter table public.extension_connections add column extension_version text;
