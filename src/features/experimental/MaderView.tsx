import { useMemo, useState } from 'react';
import { runMaderModel, type MaderInputs } from '../../physiology/mader/model';
import { MADER_EVIDENCE_NOTICE, MADER_REFERENCES } from '../../physiology/mader/references';
import { buildSubstrateProfile } from '../../physiology/substrates/metabolism';
import { SubstrateProfile } from './SubstrateProfile';

export function MaderView({ inputs }: { inputs: MaderInputs }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const result = runMaderModel(inputs, { restingVo2: 5, acknowledged });
  const substrates = useMemo(() => buildSubstrateProfile(inputs, { restingVo2: 5 }), [inputs]);
  const comparisons = [
    ['FTP', inputs.comparison?.ftpWatts], ['CP', inputs.comparison?.cpWatts],
    ['LT2', inputs.comparison?.lt2Watts], ['MLSS medido', inputs.comparison?.mlssMeasuredWatts],
  ].filter((entry): entry is [string, number] => entry[1] != null);

  return <section className="model-view experimental-view" aria-labelledby="mader-title">
    <header><div><p className="eyebrow">Laboratorio de modelos</p><h1 id="mader-title">Mader experimental</h1><p>Exploración metabólica separada de las métricas clínicas y de campo.</p></div><span className="model-version">{result.version}</span></header>
    <aside className="model-warning" aria-label="Limitaciones del modelo"><strong>Uso experimental</strong><p>{MADER_EVIDENCE_NOTICE}</p><p>FATmax modelado no equivale a LT1 y nunca actualiza LT1, zonas ni prescripciones.</p></aside>
    {result.status === 'blocked' ? <div role="alert" className="protocol-result protocol-result--warning"><h2>Cálculo bloqueado</h2>{result.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div> : <>
      <div className="model-summary"><p><span>MLSS modelado</span><strong>{result.mlssWatts.toFixed(0)} W</strong></p><p><span>FATmax modelado</span><strong>{result.fatmaxWatts.toFixed(0)} W</strong></p><p><span>Sensibilidad MLSS</span><strong>{result.sensitivity.mlssWatts.lower.toFixed(0)}–{result.sensitivity.mlssWatts.upper.toFixed(0)} W</strong></p></div>
      <p className="model-warning">{result.cadenceWarning}</p>
      {result.provenanceNotices.map((notice) => <p key={notice} className="model-warning" role="note">{notice}</p>)}
      {substrates.status === 'calculated' && <SubstrateProfile profile={substrates} />}
      <table aria-label="Comparación independiente de métricas"><thead><tr><th>Métrica independiente</th><th>Valor</th><th>Relación con el modelo</th></tr></thead><tbody>{comparisons.map(([label, watts]) => <tr key={label}><td>{label}</td><td>{watts} W</td><td>Solo comparación; no sustituida</td></tr>)}</tbody></table>
      <label className="acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> Comprendo las limitaciones y he contrastado los datos de entrada.</label>
      {/* No hay botón de informe: el módulo de Informes está sin construir y el que
          había aquí no tenía ninguna acción asociada. Se dice lo que hay. */}
      <p className="model-warning" role="note">
        {result.reportEligible
          ? 'Los informes todavía están en construcción. Este resultado queda apto para incluirse cuando existan, pero todavía no se guarda en ninguna parte.'
          : 'Los informes todavía están en construcción. Cuando existan, solo podrán incluir resultados que hayas contrastado marcando la casilla.'}
      </p>
    </>}
    <details><summary>Fuentes y formulación</summary><ul>{MADER_REFERENCES.map((reference) => <li key={reference}>{reference}</li>)}</ul></details>
  </section>;
}
