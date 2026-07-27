function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ringToKml(ring: GeoJSON.Position[]): string {
  const coords = ring.map((p) => `${p[0]},${p[1]},0`).join(' ');
  return `<LinearRing><coordinates>${coords}</coordinates></LinearRing>`;
}

function polygonToKml(poly: GeoJSON.Polygon): string {
  const outer = ringToKml(poly.coordinates[0] ?? []);
  const holes = poly.coordinates
    .slice(1)
    .map((h) => `<innerBoundaryIs>${ringToKml(h)}</innerBoundaryIs>`)
    .join('');
  return `<Polygon><outerBoundaryIs>${outer}</outerBoundaryIs>${holes}</Polygon>`;
}

function geometryToKml(geometry: GeoJSON.Geometry): string {
  if (geometry.type === 'Polygon') return polygonToKml(geometry);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((coords) => polygonToKml({ type: 'Polygon', coordinates: coords }))
      .join('');
  }
  return '';
}

export interface KmlFeatureInput {
  nome: string;
  hectaresUnicos?: number;
  geometry: GeoJSON.Geometry;
  descricaoExtra?: string;
}

/** Converte features do mapa para documento KML 2.2. */
export function bairrosParaKml(
  features: KmlFeatureInput[],
  docName: string,
): string {
  const placemarks = features
    .map((f, i) => {
      const nome = f.nome || `Área ${i + 1}`;
      const ha = Number(f.hectaresUnicos || 0).toFixed(4);
      const geom = geometryToKml(f.geometry);
      const wrapper =
        f.geometry.type === 'MultiPolygon'
          ? `<MultiGeometry>${geom}</MultiGeometry>`
          : geom;
      const desc = f.descricaoExtra
        ? `${escapeXml(f.descricaoExtra)} | hectares: ${ha}`
        : `hectares: ${ha}`;
      return `<Placemark>
  <name>${escapeXml(nome)}</name>
  <description>${desc}</description>
  <ExtendedData>
    <Data name="hectares"><value>${ha}</value></Data>
  </ExtendedData>
  ${wrapper}
</Placemark>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(docName)}</name>
${placemarks}
  </Document>
</kml>`;
}

export function baixarArquivo(
  conteudo: string,
  nomeArquivo: string,
  mime: string,
): void {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
