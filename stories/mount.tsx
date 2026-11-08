import { appRegistry } from "@/config/appRegistry";
import type { AppId } from "@/config/appRegistry";

// Mounts one registry app alone. Each story file's default export stays an inline literal (CSF indexes statically).
export const AppMount = ({ id, initialData }: { id: AppId; initialData?: unknown }) => {
  const App = appRegistry[id].component as React.ComponentType<Record<string, unknown>>;
  return (
    <App
      isWindowOpen
      isForeground
      onClose={() => {}}
      instanceId={`story-${id}`}
      initialData={initialData}
    />
  );
};

export const Placeholder = ({ name }: { name: string }) => (
  <div style={{ padding: 24, font: "14px system-ui" }}>
    {name}: not built yet (see CHECKLIST-35).
  </div>
);
