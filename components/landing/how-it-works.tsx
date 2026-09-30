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
import { CREATIVE_REJECTED, heroAt } from "@/lib/showcase";
import type { Kit } from "@/lib/types";

interface Step {
  title: string;
  body: string;
  art: React.ReactNode;
  /** Below lg the thumbnail is too small for overlays: what they said goes under the text instead. */
  aside?: React.ReactNode;
}

export function HowItWorks({ kit }: { kit: Kit }) {
  const p = kit.product;
  const find = (id: string) => kit.assets.find((a) => a.id === id);
  const fan = [find("offer"), find("marketplace"), find("whatsapp")].filter((a): a is NonNullable<typeof a> => !!a);
  const rejected = CREATIVE_REJECTED.qa!;

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
          <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-white backdrop-blur-sm max-lg:hidden">{SAMPLE_PHOTO_LABEL}</span>
        </div>
      ),
      aside: <span className="inline-flex rounded-full bg-stage-3 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-paper/90">{SAMPLE_PHOTO_LABEL}, AI-generated</span>,
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
      body: "AI Vision checks every result against your photo. This generated take of a test sneaker looked great, and was rejected: the model redesigned the shoe.",
      art: (
        <div className="relative size-full">
          <CloudImg src={publicUrl(CREATIVE_REJECTED.publicId!, { w: 480, h: 600, crop: "c_fill,g_auto" })} alt={CREATIVE_REJECTED.alt} width={480} height={600} className="size-full object-cover" />
          <QaBadge qa={rejected} className="absolute top-3 left-3 bg-studio/85 backdrop-blur-sm max-lg:hidden" />
          <span aria-hidden className="absolute top-1.5 left-1.5 grid size-7 place-items-center rounded-full bg-studio/85 text-sindoor ring-1 ring-sindoor/40 backdrop-blur-sm ring-inset lg:hidden">
            <ShieldAlert className="size-4" />
          </span>
          <ul className="absolute inset-x-0 bottom-0 grid gap-1 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pt-10 pb-3 text-[0.75rem] leading-snug font-semibold text-white max-lg:hidden">
            {rejected.reasons.map((r) => (
              <li key={r} className="flex gap-1.5">
                <span aria-hidden className="mt-[0.4em] size-1.5 shrink-0 rounded-full bg-sindoor" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      ),
      aside: (
        <div className="grid justify-items-start gap-2">
          <QaBadge qa={rejected} />
          <ul className="grid gap-1 text-[0.85rem] leading-snug text-paper/90">
            {rejected.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-sindoor" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      ),
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
          </div>
        </li>
      ))}
    </ol>
  );
}
