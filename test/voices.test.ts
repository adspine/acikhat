import { describe, expect, it, vi } from "vitest";
import { createVoiceCatalog } from "../src/integrations/voices.ts";

const raw = (voice_id: string, name: string, labels: Record<string, string> = { language: "tr" }) => ({ voice_id, name, labels });

describe("ses listesi", () => {
  it("yalnızca Türkçe sesleri alır ve adlarda yalnızca ilk adı gösterir", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({
        voices: [
          raw("a1", "Duygu Eris", { language: "tr", gender: "female", age: "young", descriptive: "confident" }),
          raw("a2", "OZAN KARACA - Genç, profesyonel", { language: "tr", gender: "male" }),
          raw("a3", "Ahu"),
          raw("a4", "gökçe deniz"),
          raw("b1", "John Smith", { language: "en" }),
        ],
      })),
    );
    const voices = await createVoiceCatalog("k", fetchFn as unknown as typeof fetch)();
    expect(voices.map((v) => v.name)).toEqual(["Duygu", "Ozan", "Ahu", "Gökçe"]);
    expect(voices[0]).toMatchObject({ gender: "female", tags: ["Genç", "Kendinden emin"] });
    expect(voices[1]).toMatchObject({ gender: "male" });
  });
});
