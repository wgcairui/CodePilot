"use client";

import { RemoteHostList } from "@/components/remote/RemoteHostList";

export default function RemoteHostsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-4">
        <RemoteHostList />
      </div>
    </div>
  );
}