"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile backdrop — closes sidebar on tap */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden h-12 flex items-center gap-3 px-3 border-b border-gray-200 bg-white flex-shrink-0">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            aria-label="Abrir menu"
          >
            <Menu size={20} className="text-gray-700" />
          </button>
          <span className="font-semibold text-sm text-gray-800">Portal Controladoria</span>
        </div>

        <main
          className="flex-1 overflow-auto"
          onClick={() => {
            setMobileOpen(false);
            window.dispatchEvent(new CustomEvent("sidebar-close-panel"));
          }}
        >
          {children}
        </main>
      </div>
    </>
  );
}
