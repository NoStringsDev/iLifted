import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Dumbbell, 
  Cat, 
  Cog, 
  Sparkles, 
  Share2, 
  Download, 
  RefreshCw, 
  ChevronRight,
  Trophy,
  ArrowLeft,
  Skull
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import confetti from 'canvas-confetti';
import { getWeightComparison, generateComparisonImage, type ComparisonResult } from './services/gemini';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Category = 'living things' | 'machinery' | 'surprise me' | 'food' | 'historical' | 'mythology';

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'living things', label: 'Living Things', icon: <Cat className="w-5 h-5" />, color: 'bg-emerald-500' },
  { id: 'machinery', label: 'Machinery', icon: <Cog className="w-5 h-5" />, color: 'bg-blue-500' },
  { id: 'food', label: 'Food', icon: <Sparkles className="w-5 h-5 text-orange-400" />, color: 'bg-orange-500' },
  { id: 'historical', label: 'History', icon: <Trophy className="w-5 h-5" />, color: 'bg-amber-500' },
  { id: 'mythology', label: 'Mythology', icon: <Skull className="w-5 h-5" />, color: 'bg-red-500' },
  { id: 'surprise me', label: 'Surprise Me', icon: <Sparkles className="w-5 h-5" />, color: 'bg-purple-500' },
];

export default function App() {
  const [weight, setWeight] = useState<string>('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>('kg');
  const [category, setCategory] = useState<Category>('living things');
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleCompare = async () => {
    if (!weight || isNaN(Number(weight))) {
      setError('Please enter a valid weight');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setImageUrl(null);
    setImageLoading(false);

    try {
      const comparison = await getWeightComparison(Number(weight), unit, category);
      setResult(comparison);
      setLoading(false);
      
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10b981', '#3b82f6', '#f59e0b']
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!result) return;
    setImageLoading(true);
    setError(null);

    try {
      const imagePromise = generateComparisonImage(result.imagePrompt);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("IMAGE_TIMEOUT")), 45000)
      );

      const img = await Promise.race([imagePromise, timeoutPromise]) as string;
      setImageUrl(img);
      setImageLoading(false);
      
      confetti({
        particleCount: 50,
        spread: 50,
        origin: { y: 0.5 },
        colors: ['#10b981', '#3b82f6']
      });
    } catch (err: any) {
      console.error("Image generation failed or timed out:", err);
      setError(err.message === "IMAGE_TIMEOUT" 
        ? "Image generation timed out. The free tier is a bit busy, try again in a moment!" 
        : "Failed to generate image. Try again?");
      setImageLoading(false);
    }
  };

  const generateCardImage = async (): Promise<string | null> => {
    if (!result || !canvasRef.current) return null;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Set canvas size (1080x1080 for square shareable card)
    canvas.width = 1080;
    canvas.height = 1080;

    // Background
    ctx.fillStyle = '#ffffff'; // white
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;

    if (imageUrl) {
      // Load AI image
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      await new Promise((resolve) => (img.onload = resolve));

      // Draw Branding
      const imgSize = 600;
      const imgX = (canvas.width - imgSize) / 2;
      const imgY = 220;

      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.font = 'bold 50px Inter';
      ctx.fillText('iLifted', imgX, 140);

      // Draw AI Image
      ctx.drawImage(img, imgX, imgY, imgSize, imgSize);

      // Text Styling
      ctx.textAlign = 'center';
      const textMaxWidth = imgSize;

      // "I lifted a total of [weight] [unit]"
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 65px Inter';
      ctx.fillText(`I lifted a total of ${weight} ${unit}`, centerX, 880);

      // "That's like lifting [shortDescription]!"
      ctx.fillStyle = '#71717a'; // zinc-500
      ctx.font = '42px Inter';
      
      const text = `That's like lifting ${result.shortDescription}!`;
      const lineHeight = 52;
      const words = text.split(' ');
      let line = '';
      let currentY = 960;

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > textMaxWidth && n > 0) {
          ctx.fillText(line, centerX, currentY);
          line = words[n] + ' ';
          currentY += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, centerX, currentY);
    } else {
      // TEXT ONLY VERSION
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      
      // Branding
      ctx.font = 'bold 60px Inter';
      ctx.fillText('iLifted', centerX, 150);

      // Main Weight
      ctx.font = 'bold 120px Inter';
      ctx.fillText(`${weight} ${unit}`, centerX, 450);
      
      ctx.font = '40px Inter';
      ctx.fillStyle = '#71717a';
      ctx.fillText('TOTAL WEIGHT LIFTED', centerX, 520);

      // Comparison
      ctx.fillStyle = '#10b981'; // emerald-500
      ctx.font = 'italic bold 80px Inter';
      
      const text = `That's like lifting ${result.shortDescription}!`;
      const lineHeight = 100;
      const words = text.split(' ');
      let line = '';
      let currentY = 750;

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > 900 && n > 0) {
          ctx.fillText(line, centerX, currentY);
          line = words[n] + ' ';
          currentY += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, centerX, currentY);

      // Footer
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '30px Inter';
      ctx.fillText('Generated by iLifted AI', centerX, 1000);
    }

    return canvas.toDataURL('image/png');
  };

  const handleDownload = async () => {
    const cardData = await generateCardImage();
    if (!cardData || !result) return;
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `ilifted_${date}_${weight}${unit}_${result.objectTag}.png`.toLowerCase();
    const link = document.createElement('a');
    link.href = cardData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    const cardData = await generateCardImage();
    if (!cardData || !result) return;
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `ilifted_${date}_${weight}${unit}_${result.objectTag}.png`.toLowerCase();
    try {
      const res = await fetch(cardData);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'image/png' });

      if (navigator.share) {
        await navigator.share({
          title: `iLifted - ${weight}${unit} ${result.objectTag}`,
          text: result.message,
          files: [file],
        });
      } else {
        await navigator.clipboard.writeText(`${result.message} #iLifted`);
        alert('Bragging rights copied to clipboard!');
      }
    } catch (err) {
      console.error('Error sharing:', err);
    }
  };

  const reset = () => {
    setResult(null);
    setImageUrl(null);
    setWeight('');
  };

  return (
    <div className="h-[100dvh] sm:h-[850px] sm:my-auto flex flex-col max-w-md mx-auto p-4 overflow-hidden bg-zinc-950 text-zinc-100 sm:rounded-[3rem] sm:border-[8px] sm:border-zinc-900 shadow-2xl relative">
      {/* Hidden canvas for card generation */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="mb-2 pt-1 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center brutal-border">
            <Dumbbell className="text-zinc-950 w-5 h-5" />
          </div>
          <h1 className="font-sans text-2xl font-black tracking-tighter">
            <span className="text-emerald-500">i</span>Lifted
          </h1>
        </div>
        <p className="text-zinc-500 text-[10px] font-medium">
          Compare your gains to the weirdest things on Earth.
        </p>
      </header>

      <main className="flex-1 flex flex-col justify-start min-h-0 pt-2">
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div
              key="input-form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col justify-start overflow-hidden"
            >
              <div className="flex flex-col justify-start space-y-6 overflow-y-auto pr-1 pb-4">
                {/* Weight Input */}
                <section>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">
                    How much did you lift?
                  </label>
                  <div className="relative group">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={weight}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                          setWeight(val);
                        }
                      }}
                      placeholder="0.0"
                      className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-2xl px-5 py-4 text-3xl font-display focus:border-emerald-500 focus:outline-none transition-colors"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex bg-zinc-800 rounded-xl p-1">
                      <button
                        onClick={() => setUnit('kg')}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold transition-all",
                          unit === 'kg' ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"
                        )}
                      >
                        KG
                      </button>
                      <button
                        onClick={() => setUnit('lbs')}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold transition-all",
                          unit === 'lbs' ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"
                        )}
                      >
                        LBS
                      </button>
                    </div>
                  </div>
                </section>

                {/* Category Selector */}
                <section>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-3">
                    Choose a Category
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setCategory(cat.id)}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-left",
                          category === cat.id 
                            ? "border-emerald-500 bg-emerald-500/10" 
                            : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                        )}
                      >
                        <div className={cn("p-1.5 rounded-lg shrink-0", cat.color, "text-zinc-950")}>
                          {React.cloneElement(cat.icon as React.ReactElement, { className: "w-4 h-4" })}
                        </div>
                        <span className="font-bold text-xs leading-tight truncate">{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {error && (
                <p className="text-red-400 text-[10px] font-medium text-center">{error}</p>
              )}

              <button
                onClick={handleCompare}
                disabled={loading || !weight}
                className="w-full brutal-btn py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0 mt-auto mb-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    Compare My Lift
                    <ChevronRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="result-view"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col min-h-0 space-y-2"
            >
              {/* Message Above Image */}
              <div className="px-2 text-center shrink-0">
                <h2 className="text-sm sm:text-base font-bold leading-tight text-zinc-100 text-balance">
                  {result.message}
                </h2>
              </div>

              {/* Result Card (UI View) */}
              <div className="flex-1 min-h-[220px] bg-white rounded-2xl overflow-hidden shadow-xl flex flex-col mx-auto w-full max-w-[320px] shrink">
                <div className="flex-1 relative bg-white min-h-0">
                  {imageUrl ? (
                    <motion.img
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      src={imageUrl}
                      alt="Comparison"
                      className="w-full h-full object-contain p-4"
                      referrerPolicy="no-referrer"
                    />
                  ) : imageLoading ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
                      <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
                      <p className="text-zinc-500 font-mono text-[8px] uppercase tracking-widest">
                        Visualizing your strength...
                      </p>
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-6 text-center">
                      <div className="space-y-1">
                        <div className="text-zinc-400 text-[10px] font-mono uppercase tracking-widest">Total Lifted</div>
                        <div className="text-zinc-950 text-4xl font-display">{weight} {unit}</div>
                      </div>
                      <div className="w-8 h-px bg-zinc-100" />
                      <button
                        onClick={handleGenerateImage}
                        className="group flex flex-col items-center gap-2"
                      >
                        <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                          <Sparkles className="w-6 h-6 text-emerald-500" />
                        </div>
                        <span className="text-zinc-950 text-xs font-bold">Show me!</span>
                        <span className="text-zinc-400 text-[8px] uppercase tracking-widest">Generate AI Visual</span>
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Card Footer with Weight & Short Desc */}
                <div className="p-3 bg-white border-t border-zinc-100 flex flex-col items-center text-center gap-0.5 shrink-0">
                  <div className="text-zinc-950 text-base font-bold truncate w-full">
                    I lifted a total of {weight} {unit}
                  </div>
                  <div className="text-zinc-500 text-xs truncate w-full">
                    That's like lifting {result.shortDescription}!
                  </div>
                  <div className="mt-1 text-[8px] font-sans font-bold text-emerald-500 tracking-widest">
                    iLifted
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 w-full shrink-0">
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 text-xs font-bold py-3 rounded-xl hover:bg-white transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-2 bg-zinc-800 text-zinc-100 text-xs font-bold py-3 rounded-xl hover:bg-zinc-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Save
                </button>
              </div>

              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-2 text-zinc-500 text-xs font-bold py-1.5 hover:text-zinc-100 transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                Try Another Lift
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-2 text-center shrink-0">
        <p className="text-[8px] font-mono tracking-[0.2em] text-zinc-600">
          Powered by Gemini AI • iLifted v1.5
        </p>
      </footer>
    </div>
  );
}
