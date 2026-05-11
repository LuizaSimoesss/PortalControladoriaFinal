import Image from "next/image";
import { Bell, User, LogOut } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <>
      {/* Top header bar — matches portal5 Header.tsx */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Image
            src="/apex-logo.jpg"
            alt="Apex Partners"
            width={80}
            height={28}
            className="h-7 w-auto object-contain"
            style={{ height: "auto" }}
            priority
          />
          <div className="w-px h-5 bg-gray-200" />
          <h1 className="text-base font-semibold text-gray-700">{title}</h1>
          {subtitle && <span className="text-sm text-gray-400">— {subtitle}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Bell size={18} className="text-gray-500" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#0078D4] rounded-full" />
          </button>
          <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
            <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center">
              <User size={16} className="text-white" />
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-700 leading-tight">Apex Controladoria</p>
              <p className="text-xs text-gray-400 leading-tight">simoesl@apexpartners.com.br</p>
            </div>
          </div>
        </div>
      </header>

      {/* Page action bar */}
      {children && (
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-end gap-3">
          {children}
        </div>
      )}
    </>
  );
}
