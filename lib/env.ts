export const env = {
  get instagramMock() {
    // Bezpečný default: mock, dokud není explicitně INSTAGRAM_MOCK=false.
    return process.env.INSTAGRAM_MOCK !== "false";
  },
  get graphApiVersion() {
    return process.env.INSTAGRAM_GRAPH_API_VERSION || "v23.0";
  },
  required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Chybí proměnná prostředí ${name}`);
    return v;
  },
};
