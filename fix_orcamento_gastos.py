import os

BASE = r"C:\Users\simoesl\desafio\portalcontroladoria6\portal"

files = [
    r"app\orcamento\receita\gestao-recursos\page.tsx",
    r"app\orcamento\receita\advisory\page.tsx",
    r"app\orcamento\receita\investment-banking\page.tsx",
    r"app\orcamento\receita\research\page.tsx",
]

R = []

# 1. Add useRef to imports
R.append((
    'import React, { useState, useMemo } from "react";',
    'import React, { useState, useMemo, useRef } from "react";'
))

# 2. Fix evalLinha (buggy → correct with tipo gate + positional product)
R.append((
    'function evalLinha(linha: LinhaOrcamento, todas: LinhaOrcamento[], ano: number, mi: number): number {\n'
    '  if (linha.composicao && linha.composicao.length > 0)\n'
    '    return linha.composicao.reduce((s, item) => s + (item.valores[pk(ano, mi)] ?? 0), 0);\n'
    '  if (linha.tipo === "digitado") return linha.valores[pk(ano, mi)] ?? 0;\n'
    '  if (!linha.formula) return 0;\n'
    '  const { op, left, right } = linha.formula;\n'
    '  const getV = (o: FormulaOperando) => {\n'
    '    if (o.valorFixo !== undefined) return o.valorFixo;\n'
    '    const t = mi + o.offset; if (t < 0 || t > 11) return 0;\n'
    '    const l = todas.find(x => x.id === o.linhaId); if (!l) return 0;\n'
    '    const v = evalLinha(l, todas, ano, t);\n'
    '    return l.isPercentual ? v / 100 : v;\n'
    '  };\n'
    '  const lv = getV(left), rv = getV(right);\n'
    '  if (op === "*") return lv * rv; if (op === "+") return lv + rv; if (op === "-") return lv - rv;\n'
    '  return rv !== 0 ? lv / rv : 0;\n'
    '}',
    'function evalLinha(linha: LinhaOrcamento, todas: LinhaOrcamento[], ano: number, mi: number): number {\n'
    '  if (linha.tipo === "digitado") {\n'
    '    if (linha.composicao && linha.composicao.length > 0)\n'
    '      return linha.composicao.reduce((s, item) => s + (item.valores[pk(ano, mi)] ?? 0), 0);\n'
    '    return linha.valores[pk(ano, mi)] ?? 0;\n'
    '  }\n'
    '  if (!linha.formula) return 0;\n'
    '  const { op, left, right } = linha.formula;\n'
    '  if (op === "*" && left.valorFixo === undefined && right.valorFixo === undefined) {\n'
    '    const tl = mi + left.offset, tr = mi + right.offset;\n'
    '    if (tl >= 0 && tl <= 11 && tr >= 0 && tr <= 11) {\n'
    '      const lL = todas.find(x => x.id === left.linhaId);\n'
    '      const rL = todas.find(x => x.id === right.linhaId);\n'
    '      if (lL?.composicao?.length && rL?.composicao?.length) {\n'
    '        return lL.composicao.reduce((sum, li, idx) => {\n'
    '          const ri = rL.composicao![idx];\n'
    '          if (!ri) return sum;\n'
    '          const lv = (li.valores[pk(ano, tl)] ?? 0) / (lL.isPercentual ? 100 : 1);\n'
    '          const rv = (ri.valores[pk(ano, tr)] ?? 0) / (rL.isPercentual ? 100 : 1);\n'
    '          return sum + lv * rv;\n'
    '        }, 0);\n'
    '      }\n'
    '    }\n'
    '  }\n'
    '  const getV = (o: FormulaOperando) => {\n'
    '    if (o.valorFixo !== undefined) return o.valorFixo;\n'
    '    const t = mi + o.offset; if (t < 0 || t > 11) return 0;\n'
    '    const l = todas.find(x => x.id === o.linhaId); if (!l) return 0;\n'
    '    const v = evalLinha(l, todas, ano, t);\n'
    '    return l.isPercentual ? v / 100 : v;\n'
    '  };\n'
    '  const lv = getV(left), rv = getV(right);\n'
    '  if (op === "*") return lv * rv; if (op === "+") return lv + rv; if (op === "-") return lv - rv;\n'
    '  return rv !== 0 ? lv / rv : 0;\n'
    '}'
))

# 3. Add onAutoSave to ComposicaoModal signature
R.append((
    'function ComposicaoModal({ linha, ano, onSave, onClose }: {\n'
    '  linha: LinhaOrcamento; ano: number;\n'
    '  onSave: (composicao: ComposicaoItem[]) => void;\n'
    '  onClose: () => void;\n'
    '})',
    'function ComposicaoModal({ linha, ano, onSave, onAutoSave, onClose }: {\n'
    '  linha: LinhaOrcamento; ano: number;\n'
    '  onSave: (composicao: ComposicaoItem[]) => void;\n'
    '  onAutoSave?: (composicao: ComposicaoItem[]) => void;\n'
    '  onClose: () => void;\n'
    '})'
))

# 4. Add initialItemsRef and handleClose after items useState
R.append((
    '  const [items, setItems] = useState<ComposicaoItem[]>(linha.composicao ?? []);\n'
    '  type TipoAdicao',
    '  const [items, setItems] = useState<ComposicaoItem[]>(linha.composicao ?? []);\n'
    '  const initialItemsRef = useRef(JSON.stringify(linha.composicao ?? []));\n'
    '  function handleClose() {\n'
    '    if (JSON.stringify(items) !== initialItemsRef.current) {\n'
    '      if (!confirm("Há alterações não salvas. Deseja descartar as mudanças?")) return;\n'
    '    }\n'
    '    onClose();\n'
    '  }\n'
    '  type TipoAdicao'
))

# 5. Update Modal onClose in ComposicaoModal
R.append((
    '<Modal title={`Composição · ${linha.descricao}`} onClose={onClose} xlWide>',
    '<Modal title={`Composição · ${linha.descricao}`} onClose={handleClose} xlWide>'
))

# 6. Update Cancelar button at bottom of ComposicaoModal
R.append((
    '          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>\n'
    '          <button onClick={() => onSave(items)}',
    '          <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>\n'
    '          <button onClick={() => onSave(items)}'
))

# 7. Add tableWidth after gruposAtivos
R.append((
    '  const gruposAtivos = GRUPOS_DEF[viewMode].filter(g => g.meses.some(mi => mi >= mIni && mi <= mFim));\n'
    '  const filtrosAtivos',
    '  const gruposAtivos = GRUPOS_DEF[viewMode].filter(g => g.meses.some(mi => mi >= mIni && mi <= mFim));\n'
    '  const tableWidth = 320 + 140 + gruposAtivos.length * 140;\n'
    '  const filtrosAtivos'
))

# 8. Add expandedLinhas state after collapsed
R.append((
    '  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());\n'
    '  const [editMode, setEditMode] = useState(false);',
    '  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());\n'
    '  const [expandedLinhas, setExpandedLinhas] = useState<Set<string>>(new Set());\n'
    '  const [editMode, setEditMode] = useState(false);'
))

# 9. Add toggleLinhaExpand after toggleCollapse
R.append((
    '  function toggleCollapse(id: string) { setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }\n'
    '  function addBloco',
    '  function toggleCollapse(id: string) { setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }\n'
    '  function toggleLinhaExpand(id: string) { setExpandedLinhas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }\n'
    '  function addBloco'
))

# 10. Add setComposicaoSilent after setComposicao
R.append((
    '  function setComposicao(bid: string, sid: string, lid: string, composicao: ComposicaoItem[]) {\n'
    '    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id !== sid ? s : { ...s, linhas: s.linhas.map(l => l.id !== lid ? l : { ...l, composicao }) }) }));\n'
    '    setModal(null);\n'
    '  }\n'
    '  function editLinha',
    '  function setComposicao(bid: string, sid: string, lid: string, composicao: ComposicaoItem[]) {\n'
    '    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id !== sid ? s : { ...s, linhas: s.linhas.map(l => l.id !== lid ? l : { ...l, composicao }) }) }));\n'
    '    setModal(null);\n'
    '  }\n'
    '  function setComposicaoSilent(bid: string, sid: string, lid: string, composicao: ComposicaoItem[]) {\n'
    '    setBlocos(b => b.map(bl => bl.id !== bid ? bl : { ...bl, subBlocos: bl.subBlocos.map(s => s.id !== sid ? s : { ...s, linhas: s.linhas.map(l => l.id !== lid ? l : { ...l, composicao }) }) }));\n'
    '  }\n'
    '  function editLinha'
))

# 11. Wire onAutoSave in ComposicaoModal usage
R.append((
    '        <ComposicaoModal\n'
    '          linha={modal.linha} ano={ano}\n'
    '          onSave={composicao => setComposicao(modal.blocoId, modal.subId, modal.linha.id, composicao)}\n'
    '          onClose={() => setModal(null)} />',
    '        <ComposicaoModal\n'
    '          linha={modal.linha} ano={ano}\n'
    '          onSave={composicao => setComposicao(modal.blocoId, modal.subId, modal.linha.id, composicao)}\n'
    '          onAutoSave={composicao => setComposicaoSilent(modal.blocoId, modal.subId, modal.linha.id, composicao)}\n'
    '          onClose={() => setModal(null)} />'
))

# 12. Fix main table (add colgroup, fix width/layout)
R.append((
    '                          <table className="w-full text-sm" style={{ minWidth: "max-content", borderCollapse: "separate", borderSpacing: 0 }}>\n'
    '                            <thead>',
    '                          <table className="text-sm" style={{ width: tableWidth, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>\n'
    '                            <colgroup>\n'
    '                              <col style={{ width: 320 }} />\n'
    '                              <col style={{ width: 140 }} />\n'
    '                              {gruposAtivos.map((_, i) => <col key={i} style={{ width: 140 }} />)}\n'
    '                            </colgroup>\n'
    '                            <thead>'
))

# 13. Fix Linha header (remove min-w)
R.append((
    '                                <th className="sticky left-0 z-10 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[240px]" style={{ background: "#f8fafc" }}>Linha</th>',
    '                                <th className="sticky left-0 z-10 px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ background: "#f8fafc" }}>Linha</th>'
))

# 14. Fix Total header (remove min-w, change left-[240px] -> left-[320px])
R.append((
    '                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[140px] border-r border-gray-200 sticky z-20 left-[240px]" style={{ background: "#f8fafc" }}>Total</th>',
    '                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 sticky z-20 left-[320px]" style={{ background: "#f8fafc" }}>Total</th>'
))

# 15. Fix group header (remove min-w)
R.append((
    '                                  <th key={g.label} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[140px]">',
    '                                  <th key={g.label} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">'
))

# 16. Add hasDetail + linhaExpanded computed values
R.append((
    '                                const total = mesesAtivos.reduce((s, mi) => s + vals[mi], 0);\n'
    '                                return (<React.Fragment key={linha.id}>',
    '                                const total = mesesAtivos.reduce((s, mi) => s + vals[mi], 0);\n'
    '                                const hasDetail = (linha.tipo === "digitado" && (linha.composicao?.length ?? 0) > 0) ||\n'
    '                                  (linha.tipo === "calculado" && linha.formula?.op === "*" &&\n'
    '                                    linha.formula.left.valorFixo === undefined && linha.formula.right.valorFixo === undefined &&\n'
    '                                    (sub.linhas.find(x => x.id === linha.formula!.left.linhaId)?.composicao?.length ?? 0) > 0 &&\n'
    '                                    (sub.linhas.find(x => x.id === linha.formula!.right.linhaId)?.composicao?.length ?? 0) > 0);\n'
    '                                const linhaExpanded = expandedLinhas.has(linha.id);\n'
    '                                return (<React.Fragment key={linha.id}>'
))

# 17. Add chevron button after GripVertical (before span with descricao)
R.append((
    '                                        {editMode && (\n'
    '                                          <GripVertical size={13} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0" />\n'
    '                                        )}\n'
    '                                        <span className="text-sm text-gray-700 flex-1">{linha.descricao}</span>',
    '                                        {editMode && (\n'
    '                                          <GripVertical size={13} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0" />\n'
    '                                        )}\n'
    '                                        {hasDetail && (\n'
    '                                          <button onClick={() => toggleLinhaExpand(linha.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors" title={linhaExpanded ? "Recolher detalhe" : "Expandir detalhe"}>\n'
    '                                            {linhaExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}\n'
    '                                          </button>\n'
    '                                        )}\n'
    '                                        <span className="text-sm text-gray-700 flex-1" title={linha.descricao}>{linha.descricao}</span>'
))

# 18. Fix Total sticky td (left-[240px] -> left-[320px])
R.append((
    '                                    <td className="px-2 py-1 text-right border-r border-gray-200 bg-gray-50/60 sticky z-10 left-[240px] group-hover:bg-blue-50/20">',
    '                                    <td className="px-2 py-1 text-right border-r border-gray-200 bg-gray-50/60 sticky z-10 left-[320px] group-hover:bg-blue-50/20">'
))

# 19. Wrap composicao sub-rows with linhaExpanded guard
R.append((
    '                                  {linha.composicao && linha.composicao.map(item => {',
    '                                  {linhaExpanded && linha.tipo === "digitado" && linha.composicao && linha.composicao.map(item => {'
))

# 20. Fix sticky td in composicao sub-rows (left-[240px] -> left-[320px])
R.append((
    '                                        <td className="px-2 py-1 text-right border-r border-gray-200 sticky z-10 left-[240px]" style={{ background: "#fafbfc" }}>',
    '                                        <td className="px-2 py-1 text-right border-r border-gray-200 sticky z-10 left-[320px]" style={{ background: "#fafbfc" }}>'
))

# 21. Add virtual calculado sub-rows + close fragment
VIRTUAL_SUBROWS = (
    '                                  {linhaExpanded && linha.tipo === "calculado" && linha.formula?.op === "*" && (() => {\n'
    '                                    const lL = sub.linhas.find(x => x.id === linha.formula!.left.linhaId);\n'
    '                                    const rL = sub.linhas.find(x => x.id === linha.formula!.right.linhaId);\n'
    '                                    if (!lL?.composicao?.length || !rL?.composicao?.length) return null;\n'
    '                                    return lL.composicao.map((li, idx) => {\n'
    '                                      const ri = rL.composicao![idx];\n'
    '                                      if (!ri) return null;\n'
    '                                      const iVals = MESES.map((_, mi) => {\n'
    '                                        const lv = (li.valores[pk(ano, mi)] ?? 0) / (lL.isPercentual ? 100 : 1);\n'
    '                                        const rv = (ri.valores[pk(ano, mi)] ?? 0) / (rL.isPercentual ? 100 : 1);\n'
    '                                        return lv * rv;\n'
    '                                      });\n'
    '                                      const iTotal = mesesAtivos.reduce((s, mi) => s + iVals[mi], 0);\n'
    '                                      return (\n'
    '                                        <tr key={li.id} className="border-b border-gray-50" style={{ background: "#fafbfc" }}>\n'
    '                                          <td className="sticky left-0 z-10 pl-8 pr-3 py-1" style={{ background: "#fafbfc" }}>\n'
    '                                            <span className="text-xs text-gray-400">↳ {li.descricao}</span>\n'
    '                                          </td>\n'
    '                                          <td className="px-2 py-1 text-right border-r border-gray-200 sticky z-10 left-[320px]" style={{ background: "#fafbfc" }}>\n'
    '                                            <span className="text-xs tabular-nums text-gray-400">{iTotal !== 0 ? fmtN(iTotal) : <span className="opacity-20">—</span>}</span>\n'
    '                                          </td>\n'
    '                                          {gruposAtivos.map(g => {\n'
    '                                            const gVal = g.meses.reduce((s, mi) => s + iVals[mi], 0);\n'
    '                                            return (\n'
    '                                              <td key={g.label} className="px-2 py-1 text-right">\n'
    '                                                <span className="text-xs tabular-nums text-gray-400">{gVal !== 0 ? fmtN(gVal) : <span className="opacity-20">—</span>}</span>\n'
    '                                              </td>\n'
    '                                            );\n'
    '                                          })}\n'
    '                                        </tr>\n'
    '                                      );\n'
    '                                    });\n'
    '                                  })()}\n'
)

R.append((
    '                                  })}\n'
    '                                </React.Fragment>);\n'
    '                              })}',
    '                                  })}\n'
    + VIRTUAL_SUBROWS
    + '                                </React.Fragment>);\n'
    '                              })}'
))

# 22. Fix subtotal table (add colgroup, fix width/layout)
R.append((
    '                      <table className="w-full text-sm" style={{ minWidth: "max-content", borderCollapse: "separate", borderSpacing: 0 }}>\n'
    '                        <tbody>',
    '                      <table className="text-sm" style={{ width: tableWidth, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}>\n'
    '                        <colgroup>\n'
    '                          <col style={{ width: 320 }} />\n'
    '                          <col style={{ width: 140 }} />\n'
    '                          {gruposAtivos.map((_, i) => <col key={i} style={{ width: 140 }} />)}\n'
    '                        </colgroup>\n'
    '                        <tbody>'
))

# 23. Add group class to subtotal tr
R.append((
    '                              <tr key={st.id} className="border-b border-blue-100 last:border-0" style={{ background: "#eff6ff" }}>',
    '                              <tr key={st.id} className="group border-b border-blue-100 last:border-0" style={{ background: "#eff6ff" }}>'
))

# 24. Remove minWidth 240 from subtotal first td
R.append((
    '                                <td className="sticky left-0 z-10 px-4 py-2" style={{ background: "#eff6ff", minWidth: 240 }}>',
    '                                <td className="sticky left-0 z-10 px-4 py-2" style={{ background: "#eff6ff" }}>'
))

# 25. Remove minWidth 140 from subtotal total td
R.append((
    '                                <td className="px-2 py-2 text-right border-r border-blue-200" style={{ minWidth: 140, background: "#dbeafe" }}>',
    '                                <td className="px-2 py-2 text-right border-r border-blue-200" style={{ background: "#dbeafe" }}>'
))

# 26. Remove minWidth from subtotal group tds
R.append((
    '                                  <td key={gi} className="px-3 py-2 text-right" style={{ minWidth: 140 }}>',
    '                                  <td key={gi} className="px-3 py-2 text-right">'
))

for rel in files:
    full = os.path.join(BASE, rel)
    with open(full, 'r', encoding='utf-8') as f:
        c = f.read()
    orig = c
    applied = []
    missed = []
    for old, new in R:
        if old in c:
            c = c.replace(old, new)
            applied.append(old[:60])
        else:
            missed.append(old[:60])

    if c != orig:
        with open(full, 'w', encoding='utf-8') as f:
            f.write(c)
        print(f"UPDATED ({len(applied)}/{len(R)} patterns): {os.path.basename(os.path.dirname(full))}")
    else:
        print(f"NO CHANGE: {os.path.basename(os.path.dirname(full))}")

    if missed:
        print(f"  MISSED ({len(missed)}):")
        for m in missed:
            print(f"    - {m!r}")
