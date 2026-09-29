'use client';

import { useState } from 'react';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import type { CloudinaryUploadWidgetInfo } from 'next-cloudinary';
import './App.css';

const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
const hasUploadPreset = Boolean(uploadPreset);

const PROMPTS_WITH_UPLOAD = [
  'Create an image gallery with lazy loading and responsive images',
  'Create a video player that plays a Cloudinary video',
  'Add image overlays with text or logos',
];

const PROMPTS_WITHOUT_UPLOAD = [
  "Let's try uploading — help me add an upload preset and upload widget",
  ...PROMPTS_WITH_UPLOAD,
];

export default function Home() {
  const [uploadedImageId, setUploadedImageId] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [clickedIds, setClickedIds] = useState(new Set<number>());

  const handleUploadSuccess = (info: CloudinaryUploadWidgetInfo) => {
    console.log('Upload successful:', info);
    // info contains everything you need to work with the uploaded asset:
    //   info.public_id   — Cloudinary asset ID (use as src for CldImage)
    //   info.secure_url  — direct HTTPS URL to the original file
    //   info.width / info.height — image dimensions
    //   info.format      — file format (e.g. 'jpg', 'png', 'webp')
    //   info.bytes       — file size in bytes
    //   info.resource_type — 'image', 'video', or 'raw'
    setUploadedImageId(info.public_id);
    setUploadedUrl(info.secure_url);
  };

  const copyPrompt = (text: string, id: number) => {
    void navigator.clipboard.writeText(text).then(() => {
      setClickedIds((prev) => new Set(prev).add(id));
      setTimeout(() => setClickedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }), 2000);
    });
  };

  const imageId = uploadedImageId ?? 'samples/people/bicycle';

  return (
    <div className="app">
      <main className="main-content">
        <h1>Cloudinary Next.js Starter Kit</h1>
        <p>This is a ready-to-use development environment with Cloudinary integration.</p>

        {hasUploadPreset && (
          <div className="upload-section">
            <h2>Upload an Image</h2>
            <CldUploadWidget
              uploadPreset={uploadPreset!}
              options={{ sources: ['local', 'camera', 'url'], multiple: false }}
              onSuccess={(result) => {
                if (typeof result.info === 'object' && result.info) {
                  handleUploadSuccess(result.info);
                }
              }}
              onError={(error) => {
                console.error('Upload error:', error);
              }}
            >
              {({ open }) => (
                <button
                  type="button"
                  onClick={() => open()}
                  style={{
                    padding: '0.75rem 1.5rem',
                    fontSize: '1rem',
                    fontWeight: 500,
                    color: 'white',
                    backgroundColor: '#6366f1',
                    border: 'none',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  Upload Image
                </button>
              )}
            </CldUploadWidget>
          </div>
        )}

        <div className="image-section">
          <h2>Display Image</h2>
          <CldImage
            src={imageId}
            width={600}
            height={400}
            crop="fill"
            gravity="auto"
            alt={uploadedImageId ? 'Your uploaded image' : 'Sample image'}
            className="display-image"
          />
          {uploadedImageId && (
            <p className="image-info">Public ID: {uploadedImageId}</p>
          )}
          {uploadedUrl && (
            <p className="image-info">
              URL:{' '}
              <a href={uploadedUrl} target="_blank" rel="noopener noreferrer">
                {uploadedUrl}
              </a>
            </p>
          )}
        </div>

        <div className="ai-prompts-section">
          <h2>🤖 Try Asking Your AI Assistant</h2>
          <p className="prompts-intro">
            <strong>Copy and paste</strong> one of these prompts into your AI assistant:
          </p>
          <ul className="prompts-list">
            {(hasUploadPreset ? PROMPTS_WITH_UPLOAD : PROMPTS_WITHOUT_UPLOAD).map((text, i) => (
              <li
                key={i}
                onClick={() => copyPrompt(text, i)}
                title="Click to copy"
                className={clickedIds.has(i) ? 'clicked' : ''}
              >
                {text}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
