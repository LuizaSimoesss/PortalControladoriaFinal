"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { prefetchKeys, PREFETCH_ORCADO_KEYS } from "@/lib/storage";
import {
  BookOpen, Building2, FolderOpen, Users, Briefcase,
  TrendingUp, BarChart3, FileSpreadsheet, Settings,
  ChevronDown, ChevronRight, Network, PanelLeftClose, PanelLeftOpen,
  LayoutDashboard, Plug, ClipboardList, PieChart, ShieldAlert, AlertTriangle, Target, FileDown, MapPin, GitMerge, Database,
} from "lucide-react";
import { useState, createContext, useContext, useEffect } from "react";

const MobileCloseCtx = createContext<() => void>(() => {});

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
      { label: "Polo",                path: "/cadastros/polo",             icon: <MapPin size={15} /> },
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
    label: "Orçado",
    shortLabel: "Orçado",
    icon: <Target size={18} />,
    children: [
      {
        label: "Orçamento",
        icon: <BarChart3 size={15} />,
        children: [
          {
            label: "Receita",
            icon: <TrendingUp size={14} />,
            children: [
              { label: "Gestão de Recursos",  path: "/orcamento/receita/gestao-recursos",     icon: <BarChart3 size={13} /> },
              { label: "Investment Banking",  path: "/orcamento/receita/investment-banking",   icon: <BarChart3 size={13} /> },
              { label: "Advisory",            path: "/orcamento/receita/advisory",             icon: <BarChart3 size={13} /> },
              { label: "Research",            path: "/orcamento/receita/research",             icon: <BarChart3 size={13} /> },
            ],
          },
          {
            label: "Gastos",
            icon: <TrendingUp size={14} />,
            children: [
              { label: "Pacote de Pessoal",                 path: "/orcamento/gastos/pacote-pessoal",                 icon: <BarChart3 size={13} /> },
              { label: "Pacote de Certificação",            path: "/orcamento/gastos/pacote-certificacao",            icon: <BarChart3 size={13} /> },
              { label: "Pacote de Incentivos Comerciais",   path: "/orcamento/gastos/pacote-incentivos-comerciais",   icon: <BarChart3 size={13} /> },
              { label: "Pacote Institucional",              path: "/orcamento/gastos/pacote-institucional",           icon: <BarChart3 size={13} /> },
              { label: "Pacote Ocupação",                   path: "/orcamento/gastos/pacote-ocupacao",                icon: <BarChart3 size={13} /> },
              { label: "Pacote de Eventos",                 path: "/orcamento/gastos/pacote-eventos",                 icon: <BarChart3 size={13} /> },
              { label: "Pacote de Serviços Especializados", path: "/orcamento/gastos/pacote-servicos-especializados", icon: <BarChart3 size={13} /> },
              { label: "Pacote de Serviços Jurídicos",      path: "/orcamento/gastos/pacote-servicos-juridicos",      icon: <BarChart3 size={13} /> },
              { label: "Pacote de Tecnologia",              path: "/orcamento/gastos/pacote-tecnologia",              icon: <BarChart3 size={13} /> },
              { label: "Pacote de Viagens",                 path: "/orcamento/gastos/pacote-viagens",                 icon: <BarChart3 size={13} /> },
            ],
          },
        ],
      },
      {
        label: "Forecast",
        icon: <TrendingUp size={15} />,
        children: [
          {
            label: "Receita",
            icon: <TrendingUp size={14} />,
            children: [
              { label: "Gestão de Recursos",  path: "/orcamento/forecast/receita/gestao-recursos",     icon: <BarChart3 size={13} /> },
              { label: "Investment Banking",  path: "/orcamento/forecast/receita/investment-banking",   icon: <BarChart3 size={13} /> },
              { label: "Advisory",            path: "/orcamento/forecast/receita/advisory",             icon: <BarChart3 size={13} /> },
              { label: "Research",            path: "/orcamento/forecast/receita/research",             icon: <BarChart3 size={13} /> },
            ],
          },
          {
            label: "Gastos",
            icon: <TrendingUp size={14} />,
            children: [
              { label: "Pacote de Pessoal",                 path: "/orcamento/forecast/gastos/pacote-pessoal",                 icon: <BarChart3 size={13} /> },
              { label: "Pacote de Certificação",            path: "/orcamento/forecast/gastos/pacote-certificacao",            icon: <BarChart3 size={13} /> },
              { label: "Pacote de Incentivos Comerciais",   path: "/orcamento/forecast/gastos/pacote-incentivos-comerciais",   icon: <BarChart3 size={13} /> },
              { label: "Pacote Institucional",              path: "/orcamento/forecast/gastos/pacote-institucional",           icon: <BarChart3 size={13} /> },
              { label: "Pacote Ocupação",                   path: "/orcamento/forecast/gastos/pacote-ocupacao",                icon: <BarChart3 size={13} /> },
              { label: "Pacote de Eventos",                 path: "/orcamento/forecast/gastos/pacote-eventos",                 icon: <BarChart3 size={13} /> },
              { label: "Pacote de Serviços Especializados", path: "/orcamento/forecast/gastos/pacote-servicos-especializados", icon: <BarChart3 size={13} /> },
              { label: "Pacote de Serviços Jurídicos",      path: "/orcamento/forecast/gastos/pacote-servicos-juridicos",      icon: <BarChart3 size={13} /> },
              { label: "Pacote de Tecnologia",              path: "/orcamento/forecast/gastos/pacote-tecnologia",              icon: <BarChart3 size={13} /> },
              { label: "Pacote de Viagens",                 path: "/orcamento/forecast/gastos/pacote-viagens",                 icon: <BarChart3 size={13} /> },
            ],
          },
        ],
      },
    ],
  },
  {
    label: "Relatórios",
    shortLabel: "Relat.",
    icon: <PieChart size={18} />,
    children: [
      {
        label: "DRE - Gerencial",
        icon: <BarChart3 size={15} />,
        children: [
          { label: "Realizada",    path: "/relatorios/demonstracao-resultado-exercicio/realizada",         icon: <BarChart3 size={14} /> },
          { label: "Orçado",      path: "/relatorios/demonstracao-resultado-exercicio/orcado",         icon: <BarChart3 size={14} /> },
          { label: "Orç × Real",  path: "/relatorios/demonstracao-resultado-exercicio/comparativo",    icon: <BarChart3 size={14} /> },
          { label: "Ano × Ano",   path: "/relatorios/demonstracao-resultado-exercicio/comparativo-anos", icon: <BarChart3 size={14} /> },
          { label: "Forecast",    path: "/relatorios/demonstracao-resultado-exercicio/forecast",        icon: <BarChart3 size={14} /> },
        ],
      },
      {
        label: "DRE - Contábil",
        icon: <BarChart3 size={15} />,
        children: [
          { label: "Realizada",   path: "/relatorios/demonstracao-resultado-contabil/realizada",            icon: <BarChart3 size={14} /> },
          { label: "Orçado",      path: "/relatorios/demonstracao-resultado-contabil/orcado",            icon: <BarChart3 size={14} /> },
          { label: "Orç × Real",  path: "/relatorios/demonstracao-resultado-contabil/comparativo",       icon: <BarChart3 size={14} /> },
          { label: "Ano × Ano",       path: "/relatorios/demonstracao-resultado-contabil/comparativo-anos",             icon: <BarChart3 size={14} /> },
          { label: "Ano × Ano × Orç", path: "/relatorios/demonstracao-resultado-contabil/comparativo-anos-orcamento", icon: <BarChart3 size={14} /> },
          { label: "Forecast",        path: "/relatorios/demonstracao-resultado-contabil/forecast",                   icon: <BarChart3 size={14} /> },
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
      {
        label: "Receita",
        icon: <TrendingUp size={15} />,
        children: [
          { label: "Folha Business", path: "/relatorios/receita/folha-business", icon: <FileSpreadsheet size={14} /> },
        ],
      },
      { label: "Subscrição", path: "/relatorios/subscricao", icon: <GitMerge size={15} /> },
      { label: "Gerar Relatórios", path: "/relatorios/gerar", icon: <FileDown size={14} /> },
    ],
  },
  {
    label: "Validações",
    shortLabel: "Valid.",
    icon: <ShieldAlert size={18} />,
    children: [
{ label: "DRE Gerencial", path: "/validacoes/dre-gerencial", icon: <BarChart3 size={15} /> },
      { label: "DRE Contábil", path: "/validacoes/dre-contabil", icon: <BarChart3 size={15} /> },
      { label: "Dados Históricos", path: "/validacoes/dados-historicos", icon: <BarChart3 size={15} /> },
      { label: "Receitas", path: "/validacoes/gestao-fundos-consultoria", icon: <Briefcase size={15} /> },
    ],
  },
  {
    label: "Salesforce",
    shortLabel: "SF",
    icon: <Database size={18} />,
    children: [
      { label: "Consultas", path: "/salesforce/consultas", icon: <Database size={15} /> },
      { label: "Subscrição", path: "/relatorios/subscricao", icon: <GitMerge size={15} /> },
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
          { label: "Sankhya",     path: "/configuracoes/sankhya",     icon: <Network size={14} /> },
          {
            label: "Salesforce",
            icon: <Network size={14} />,
            children: [
              { label: "Credenciais",     path: "/configuracoes/salesforce",                    icon: <Network size={13} /> },
              { label: "Consulta Tabela", path: "/configuracoes/salesforce/consulta-tabela",    icon: <Database size={13} /> },
            ],
          },
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
  const onMobileClose = useContext(MobileCloseCtx);

  if (!item.children) {
    const active = item.path ? (pathname === item.path || pathname.startsWith(item.path + "/")) : false;
    return (
      <Link
        href={item.path!}
        onClick={onMobileClose}
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

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ mobileOpen = false, onMobileClose = () => {} }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [activeCatIdx, setActiveCatIdx] = useState<number | null>(() => {
    const idx = menuItems.findIndex((m) => isActive(m, pathname));
    return idx >= 0 ? idx : 0;
  });
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    function handler() { setPanelOpen(false); }
    window.addEventListener("sidebar-close-panel", handler);
    return () => window.removeEventListener("sidebar-close-panel", handler);
  }, []);

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
      if (item.label === "Orçado") prefetchKeys(PREFETCH_ORCADO_KEYS);
    }
  };

  const activeItem = activeCatIdx !== null ? menuItems[activeCatIdx] : null;

  return (
    <MobileCloseCtx.Provider value={onMobileClose}>
    <div
      className={`flex h-screen flex-shrink-0 fixed md:relative inset-y-0 left-0 z-40 transition-transform duration-200 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}
    >
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
    </MobileCloseCtx.Provider>
  );
}
