import React from 'react';

function getColor(value) {
    if (value === null || value === undefined) return 'bg-slate-100 text-slate-300';
    if (value >= 99) return 'bg-emerald-500 text-white';
    if (value >= 95) return 'bg-yellow-400 text-white';
    if (value >= 80) return 'bg-orange-400 text-white';
    return 'bg-red-500 text-white';
}

export default function AvailabilityHeatmap({ data, terminals, labels }) {
    if (!terminals?.length || !data?.length) return (
        <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
            Sem dados para o período selecionado
        </div>
    );

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[500px]">
                <thead>
                    <tr>
                        <th className="text-left text-slate-500 font-medium py-1 pr-3 min-w-[120px]">Terminal</th>
                        {labels.map(l => (
                            <th key={l} className="text-center text-slate-400 font-normal py-1 px-1 min-w-[36px]">{l}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {terminals.slice(0, 15).map(t => (
                        <tr key={t.id}>
                            <td className="text-slate-700 font-medium py-1 pr-3 truncate max-w-[140px]" title={t.nome}>{t.nome}</td>
                            {data.map((bucket, i) => {
                                const val = bucket[t.id];
                                return (
                                    <td key={i} className="py-1 px-0.5 text-center">
                                        <div
                                            className={`rounded text-[10px] font-bold h-6 flex items-center justify-center ${getColor(val)}`}
                                            title={val != null ? `${val.toFixed(1)}%` : 'Sem dados'}
                                        >
                                            {val != null ? Math.round(val) : '—'}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
                <span className="font-medium">Legenda:</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> ≥99%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400 inline-block" /> 95-99%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" /> 80-95%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> &lt;80%</span>
            </div>
        </div>
    );
}