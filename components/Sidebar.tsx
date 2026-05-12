"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen, Building2, FolderOpen, Users, Briefcase,
  TrendingUp, BarChart3, FileSpreadsheet, Settings,
  ChevronDown, ChevronRight, Network, PanelLeftClose, PanelLeftOpen,
  LayoutDashboard, Plug, ClipboardList, PieChart, ShieldAlert, AlertTriangle,
} from "lucide-react";
import { useState } from "react";

interface MenuItem {
  label: string;
  shortLabel?: string;
  path?: string;
  icon: React.ReactNode;
  children?: MenuItem[];
}

const menuItems: MenuItem[] = [
  {
    label: "Cadastros",
    shortLabel: "Cadastro",
    icon: <BookOpen size={18} />,
    children: [
      { label: "Natureza",            path: "/cadastros/natureza",         icon: <FileSpreadsheet size={15} /> },
      { label: "Centro de Resultado", path: "/cadastros/centro-resultado", icon: <BarChart3 size={15} /> },
      { label: "Projetos",            path: "/cadastros/projetos",         icon: <FolderOpen size={15} /> },
      { label: "Parceiro",            path: "/cadastros/parceiro",         icon: <Users size={15} /> },
      { label: "Empresas",            path: "/cadastros/empresas",         icon: <Building2 size={15} /> },
      { label: "Adquiridas",          path: "/cadastros/adquiridas",       icon: <Briefcase size={15} /> },
      { label: "Indicadores",         path: "/cadastros/indicadores",      icon: <TrendingUp size={15} /> },
      { label: "Demonstrativos",      path: "/cadastros/demonstrativos",   icon: <LayoutDashboard size={15} /> },
    ],
  },
  {
    label: "Lançamentos",
    shortLabel: "Lançto",
    icon: <ClipboardList size={18} />,
    children: [
      { label: "Financeiro",  path: "/lancamentos/financeiro",  icon: <BarChart3 size={15} /> },
      { label: "Indicadores", path: "/lancamentos/indicadores", icon: <TrendingUp size={15} /> },
    ],
  },
  {
    label: "Relatórios",
    shortLabel: "Relat.",
    icon: <PieChart size={18} />,
    children: [
      {
        label: "Dem. Resultado do Exercício",
        icon: <BarChart3 size={15} />,
        children: [
          { label: "Realizada",    path: "/relatorios/demonstracao-resultado-exercicio/realizada",    icon: <BarChart3 size={14} /> },
          { label: "Orçado",      path: "/relatorios/demonstracao-resultado-exercicio/orcado",      icon: <BarChart3 size={14} /> },
          { label: "Orç × Real",  path: "/relatorios/demonstracao-resultado-exercicio/comparativo", icon: <BarChart3 size={14} /> },
        ],
      },
      {
        label: "Indicadores",
        icon: <TrendingUp size={15} />,
        children: [
          { label: "Realizado",   path: "/relatorios/indicadores/realizado",    icon: <TrendingUp size={14} /> },
          { label: "Orçado",     path: "/relatorios/indicadores/orcado",       icon: <TrendingUp size={14} /> },
          { label: "Orç × Real", path: "/relatorios/indicadores/comparativo",  icon: <TrendingUp size={14} /> },
        ],
      },
    ],
  },
  {
    label: "Validações",
    shortLabel: "Valid.",
    icon: <ShieldAlert size={18} />,
    children: [
      { label: "Lançtos. sem Alocação", path: "/validacoes/lancamentos-sem-alocacao",         icon: <AlertTriangle size={15} /> },
      { label: "Receitas", path: "/validacoes/gestao-fundos-consultoria", icon: <Briefcase size={15} /> },
    ],
  },
  {
    label: "Configuração",
    shortLabel: "Config",
    icon: <Settings size={18} />,
    children: [
      {
        label: "Integrações",
        icon: <Plug size={15} />,
        children: [
          { label: "Sankhya", path: "/configuracoes/sankhya", icon: <Network size={14} /> },
        ],
      },
    ],
  },
];

function isActive(item: MenuItem, pathname: string): boolean {
  if (item.path) return pathname === item.path || pathname.startsWith(item.path + "/");
  if (item.children) return item.children.some((c) => isActive(c, pathname));
  return false;
}

function SubItem({ item, depth }: { item: MenuItem; depth: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => isActive(item, pathname));

  if (!item.children) {
    const active = item.path ? (pathname === item.path || pathname.startsWith(item.path + "/")) : false;
    return (
      <Link
        href={item.path!}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        className={`flex items-center gap-2 pr-4 py-2 text-sm whitespace-nowrap transition-all rounded-sm mx-1 ${
          active ? "bg-[#0078D4] text-white font-medium" : "text-white/80 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span className="flex-shrink-0 opacity-80">{item.icon}</span>
        <span className="uppercase tracking-wide text-xs">{item.label}</span>
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        className="flex items-center gap-2 pr-4 py-2 text-white/80 hover:bg-white/10 hover:text-white transition-all w-full whitespace-nowrap rounded-sm mx-1"
      >
        <span className="flex-shrink-0 opacity-80">{item.icon}</span>
        <span className="flex-1 text-left uppercase tracking-wide text-xs">{item.label}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && item.children.map((child, i) => (
        <SubItem key={i} item={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [activeCatIdx, setActiveCatIdx] = useState<number | null>(() => {
    const idx = menuItems.findIndex((m) => isActive(m, pathname));
    return idx >= 0 ? idx : 0;
  });
  const [panelOpen, setPanelOpen] = useState(true);

  const handleIconClick = (idx: number, item: MenuItem) => {
    if (item.path) {
      router.push(item.path);
      setActiveCatIdx(idx);
      setPanelOpen(false);
      return;
    }
    if (activeCatIdx === idx && panelOpen) {
      setPanelOpen(false);
    } else {
      setActiveCatIdx(idx);
      setPanelOpen(true);
    }
  };

  const activeItem = activeCatIdx !== null ? menuItems[activeCatIdx] : null;

  return (
    <div className="flex h-screen flex-shrink-0">
      {/* ── Panel 1: Icon strip ── */}
      <div className="flex flex-col h-full flex-shrink-0" style={{ width: 58, background: "#002b5c" }}>
        {/* Logo */}
        <div className="h-14 flex items-center justify-center border-b border-white/10 flex-shrink-0">
          <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: "#0078D4" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L15 8L8 15L1 8L8 1Z" fill="white" />
            </svg>
          </div>
        </div>

        {/* Icons */}
        <nav className="flex-1 flex flex-col items-center py-2 gap-0.5 overflow-y-auto">
          {menuItems.map((item, idx) => {
            const active = activeCatIdx === idx;
            const isCurrent = isActive(item, pathname);
            return (
              <button
                key={idx}
                onClick={() => handleIconClick(idx, item)}
                title={item.label}
                className="w-11 h-11 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all"
                style={{
                  background: active || isCurrent ? "#0078D4" : "transparent",
                  color: active || isCurrent ? "white" : "rgba(255,255,255,0.6)",
                }}
                onMouseEnter={(e) => {
                  if (!active && !isCurrent) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
                }}
                onMouseLeave={(e) => {
                  if (!active && !isCurrent) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                {item.icon}
                <span style={{ fontSize: 7.5, lineHeight: 1.2, textAlign: "center", maxWidth: 40, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {item.shortLabel || item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Toggle */}
        <div className="h-10 flex items-center justify-center border-t border-white/10 flex-shrink-0">
          <button
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? "Fechar menu" : "Abrir menu"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", padding: 4 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "white"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)"; }}
          >
            {panelOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        </div>
      </div>

      {/* ── Panel 2: Submenu ── */}
      {panelOpen && activeItem?.children && (
        <div
          className="flex flex-col h-full flex-shrink-0 border-r border-white/10"
          style={{ background: "#003d82", minWidth: 180, width: "max-content" }}
        >
          <div className="h-14 flex items-center px-4 border-b border-white/10 flex-shrink-0">
            <p className="text-white font-bold text-xs uppercase tracking-widest whitespace-nowrap">{activeItem.label}</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {activeItem.children.map((child, i) => (
              <SubItem key={i} item={child} depth={0} />
            ))}
          </nav>
          {/* Footer */}
          <div className="p-3 border-t border-white/10 flex-shrink-0">
            <p className="text-white/40 text-[10px] whitespace-nowrap">Portal Controladoria · Apex</p>
          </div>
        </div>
      )}
    </div>
  );
}
