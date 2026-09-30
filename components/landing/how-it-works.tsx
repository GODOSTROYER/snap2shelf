/**
 * How it works, told with the real sample: each step is the actual image the
 * pipeline produced at that point. Server-rendered, no client JS.
 */
import { CloudImg } from "@/components/cloud-img";
import { QaBadge } from "@/components/kit/qa-badge";
import { publicUrl, sizedUrl } from "@/lib/client/img";
import { CREATIVE_REJECTED, heroAt } from "@/lib/showcase";
import type { Kit } from "@/lib/types";

export function HowItWorks({ kit }: { kit: Kit }) {
  const p = kit.product;
  const find = (id: string) => kit.assets.find((a) => a.id === id);
  const fan = [find("offer"), find("marketplace"), find("whatsapp")].filter((a): a is NonNullable<typeof a> => !!a);

  const steps = [
    {
      title: "Snap",
      body: "Upload a photo, or scan a QR code and take one with your phone. Any background, any light.",
      art: <CloudImg src={publicUrl(p.rawPublicId, { w: 480, h: 600, crop: "c_fill,g_auto" })} alt="The original phone photo of the sneaker" width={480} height={600} className="size-full object-cover" />,
    },
    {
      title: "Cut out",
      body: "The product is lifted off its background once. Every shot after this reuses the same cut-out.",
      art: (
        <div className="checker size-full">
          <CloudImg src={publicUrl(p.cutout!.publicId, { w: 480, h: 600, crop: "c_pad,b_rgb:00000000" })} alt="The sneaker cut out, on a transparent background" width={480} height={600} className="size-full bg-transparent object-cover" />
        </div>
      ),
    },
    {
      title: "Stage",
      body: "Placed on a ready-made scene. AI Vision already knows where its surface is and where the light comes from, so the shadow falls the right way.",
      art: <CloudImg src={heroAt(kit, 480)} alt={kit.hero.alt} width={480} height={600} className="size-full object-cover" />,
    },
    {
      title: "Check",
      body: "AI Vision compares every result with your photo. This generated take looked great, and was rejected: it changed the shoe.",
      art: (
        <div className="relative size-full">
          <CloudImg src={publicUrl(CREATIVE_REJECTED.publicId!, { w: 480, h: 600, crop: "c_fill,g_auto" })} alt={CREATIVE_REJECTED.alt} width={480} height={600} className="size-full object-cover" />
          <QaBadge qa={CREATIVE_REJECTED.qa!} className="absolute top-3 left-3 bg-studio/85 backdrop-blur-sm" />
          <ul className="absolute inset-x-0 bottom-0 grid gap-1 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pt-10 pb-3 text-[0.74rem] leading-snug font-semibold text-white">
            {CREATIVE_REJECTED.qa!.reasons.map((r) => (
              <li key={r} className="flex gap-1.5">
                <span aria-hidden className="mt-[0.4em] size-1.5 shrink-0 rounded-full bg-sindoor" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    {
      title: "Ship",
      body: "A feed post, story, banner, marketplace image, catalog tile, colour variants, a Hindi and English offer and a reel. One zip.",
      art: (
        <div className="relative size-full bg-stage">
          {fan.map((a, i) => (
            <div
              key={a.id}
              className="absolute top-1/2 left-1/2 w-[58%] overflow-hidden rounded-lg shadow-[0_18px_30px_-12px_rgb(0_0_0/0.9)] ring-1 ring-white/10"
              style={{ transform: `translate(-50%, -50%) translate(${(i - 1) * 22}%, ${Math.abs(i - 1) * 6}%) rotate(${(i - 1) * 11}deg)`, zIndex: i === 1 ? 2 : 1 }}
            >
              <CloudImg src={sizedUrl(a, 320)} alt={a.label} width={a.width} height={a.height} className="block w-full bg-frame-line" />
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <ol className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-6 lg:overflow-visible lg:px-0">
      {steps.map((s, i) => (
        <li key={s.title} className="relative w-[72vw] max-w-[19rem] shrink-0 snap-start lg:w-auto lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-stage-2 ring-1 ring-line">{s.art}</div>
          <div className="mt-4 flex items-baseline gap-2.5">
            <span aria-hidden className="tabular font-display text-lg font-extrabold text-marigold">
              {i + 1}
            </span>
            <h3 className="font-display text-xl font-bold tracking-[-0.02em]">{s.title}</h3>
          </div>
          <p className="mt-1.5 text-[0.92rem] leading-relaxed text-dim">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
