/**
 * How it works, told with the real sample: each step is the actual image the
 * pipeline produced at that point. Server-rendered, no client JS.
 *
 * Phones and tablets read it as a vertical timeline (thumbnail left, text
 * right, a thin line joining the steps), so every step, the QA rejection
 * included, is on the page without swiping. Wide screens show five columns.
 */
import { ShieldAlert } from "lucide-react";
import { CloudImg } from "@/components/cloud-img";
import { QaBadge } from "@/components/kit/qa-badge";
import { SAMPLE_PHOTO_LABEL } from "@/lib/claims";
import { publicUrl, sizedUrl } from "@/lib/client/img";
import { heroAt, type LandingQaCatch } from "@/lib/showcase";
import { PLATE, type Kit } from "@/lib/types";

interface Step {
  title: string;
  body: string;
  art: React.ReactNode;
  /** Below lg the thumbnail is too small for overlays: what they said goes under the text instead. */
  aside?: React.ReactNode;
  /** Under the text at every size. */
  note?: React.ReactNode;
}

const NTH = ["first", "second", "third", "fourth", "fifth", "sixth"];
const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0];

/** The studio's QA mark (components/studio/stage.tsx FixMarks): a dashed ring where the product's base sits. */
function BaseRing({ base }: { base: NonNullable<LandingQaCatch["base"]> }) {
  const w = base.w * PLATE.width;
  const ew = Math.max(150, Math.min(w * 1.6, w + 160));
  const eh = ew * 0.26;
  return (
    <span
      aria-hidden
      className="absolute rounded-[50%] border-2 border-dashed border-sindoor [filter:drop-shadow(0_0_2px_rgb(0_0_0/0.6))] max-lg:border-[1.5px]"
      style={{
        left: `${(base.cx - ew / 2 / PLATE.width) * 100}%`,
        top: `${(base.y - eh / 2 / PLATE.height) * 100}%`,
        width: `${(ew / PLATE.width) * 100}%`,
        height: `${(eh / PLATE.height) * 100}%`,
      }}
    />
  );
}

/** `qaCatch`: the same product's first placement, as the live QA rejected it (lib/showcase landingQaCatch). */
export function HowItWorks({ kit, qaCatch }: { kit: Kit; qaCatch: LandingQaCatch | null }) {
  const p = kit.product;
  const noun = p.understanding?.name.toLowerCase() ?? "product";
  const find = (id: string) => kit.assets.find((a) => a.id === id);
  const fan = [find("offer"), find("marketplace"), find("whatsapp")].filter((a): a is NonNullable<typeof a> => !!a);

  // Check: this product's own rejected first attempt, with the reasons the live QA gave
  const c = qaCatch;
  const floating = !!c?.qa.matched?.includes("product-floating");
  const catchBody = c
    ? `AI Vision checks every result against your photo. QA caught the first placement ${floating ? "floating above the counter" : "looking wrong"}; the studio ${floating ? "set it lower" : "re-staged it"} and checked again — approved on the ${NTH[c.attempts - 1] ?? `${c.attempts}th`} check.`
    : "AI Vision checks every result against your photo: nothing about the product may change. This one passed first time.";
  const catchArt = c ? (
    <div className="relative size-full">
      <CloudImg
        src={c.src(480)}
        alt={`The first placement of the ${noun}, which QA rejected: ${firstSentence(c.qa.reasons[0] ?? "it looked off.").replace(/^The product /, "it ")}`}
        width={480}
        height={600}
        className="size-full object-cover"
      />
      {c.base ? <BaseRing base={c.base} /> : null}
      <QaBadge qa={c.qa} className="absolute top-3 left-3 bg-studio/85 backdrop-blur-sm max-lg:hidden" />
      <span aria-hidden className="absolute top-1.5 left-1.5 grid size-7 place-items-center rounded-full bg-studio/85 text-sindoor ring-1 ring-sindoor/40 backdrop-blur-sm ring-inset lg:hidden">
        <ShieldAlert className="size-4" />
      </span>
    </div>
  ) : (
    <div className="relative size-full">
      <CloudImg src={heroAt(kit, 480)} alt={kit.hero.alt} width={480} height={600} className="size-full object-cover" />
      <QaBadge qa={{ status: "approved" }} className="absolute top-3 left-3 bg-studio/85 backdrop-blur-sm max-lg:hidden" />
    </div>
  );
  const catchNote = c ? (
    <div className="grid justify-items-start gap-2">
      <QaBadge qa={c.qa} className="lg:hidden" />
      <ul className="grid gap-1 text-[0.85rem] leading-snug text-paper/90" aria-label="What QA said">
        {c.qa.reasons.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-sindoor" />
            {firstSentence(r)}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const steps: Step[] = [
    {
      title: "Snap",
      body: "Upload a photo, or scan a QR code and take one with your phone. Any background, any light.",
      art: (
        <div className="relative size-full">
          <CloudImg
            src={publicUrl(p.rawPublicId, { w: 480, h: 600, crop: "c_fill,g_auto" })}
            alt={`${SAMPLE_PHOTO_LABEL}, an AI-generated test image: ${p.caption ?? "the product on a plain floor"}`}
            width={480}
            height={600}
            className="size-full object-cover"
          />
          <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-white backdrop-blur-sm max-lg:hidden">
            {SAMPLE_PHOTO_LABEL} · AI-generated
          </span>
        </div>
      ),
      aside: <span className="inline-flex rounded-full bg-stage-3 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-paper/90">{SAMPLE_PHOTO_LABEL} · AI-generated</span>,
    },
    {
      title: "Cut out",
      body: "The product is lifted off its background once. Every shot after this reuses the same cut-out.",
      art: (
        <div className="checker size-full">
          <CloudImg src={publicUrl(p.cutout!.publicId, { w: 480, h: 600, crop: "c_pad,b_rgb:00000000" })} alt={`The ${p.understanding?.name.toLowerCase() ?? "product"} cut out, on a transparent background`} width={480} height={600} className="size-full bg-transparent object-cover" />
        </div>
      ),
    },
    {
      title: "Stage",
      body: "Placed on a ready-made scene. AI Vision already knows where its surface is and where the light comes from, so the shadows fall the right way and the tone matches.",
      art: <CloudImg src={heroAt(kit, 480)} alt={kit.hero.alt} width={480} height={600} className="size-full object-cover" />,
    },
    {
      title: "Check",
      body: catchBody,
      art: catchArt,
      note: catchNote,
    },
    {
      title: "Ship",
      body: "A feed post, story, banner, marketplace image, catalog tile, colour variants and a Hindi and English offer, in one zip. Plus a reel, streamed from one URL.",
      art: (
        <div className="relative size-full bg-stage">
          {fan.map((a, i) => (
            <div
              key={a.id}
              className="absolute top-1/2 left-1/2 w-[58%] overflow-hidden rounded-lg shadow-[0_18px_30px_-12px_rgb(0_0_0/0.9)] ring-1 ring-white/10 max-lg:rounded-[0.3rem]"
              style={{ transform: `translate(-50%, -50%) translate(${(i - 1) * 22}%, ${Math.abs(i - 1) * 6}%) rotate(${(i - 1) * 11}deg)`, zIndex: i === 1 ? 2 : 1 }}
            >
              <CloudImg src={sizedUrl(a, 360)} alt={`${a.label}: ${a.alt}`} width={a.width} height={a.height} className="block w-full bg-frame-line" />
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <ol className="grid lg:grid-cols-5 lg:gap-6">
      {steps.map((s, i) => (
        <li key={s.title} className="relative grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 pb-9 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-7 sm:pb-12 lg:block lg:pb-0">
          {/* the thin line down to the next step's thumbnail */}
          {i < steps.length - 1 ? (
            <span aria-hidden className="absolute top-[calc(7.5rem+0.75rem)] bottom-3 left-12 w-px bg-line-strong sm:top-[calc(12.5rem+0.75rem)] sm:left-20 lg:hidden" />
          ) : null}
          <div className="relative aspect-[4/5] self-start overflow-hidden rounded-xl bg-stage-2 ring-1 ring-line lg:rounded-2xl">{s.art}</div>
          <div className="min-w-0 pt-0.5 lg:mt-4 lg:pt-0">
            <div className="flex items-baseline gap-2.5">
              <span aria-hidden className="tabular font-display text-lg font-extrabold text-marigold">
                {i + 1}
              </span>
              <h3 className="font-display text-xl font-bold tracking-[-0.02em]">{s.title}</h3>
            </div>
            <p className="mt-1.5 text-[0.92rem] leading-relaxed text-dim">{s.body}</p>
            {s.aside ? <div className="mt-3 lg:hidden">{s.aside}</div> : null}
            {s.note ? <div className="mt-3">{s.note}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
