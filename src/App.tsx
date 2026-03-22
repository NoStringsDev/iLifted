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

type Category = 'surprise me' | 'mythology' | 'historical' | 'machinery' | 'living things';

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string; activeBorder: string; activeBg: string; activeText: string }[] = [
  { id: 'surprise me', label: 'Surprise Me', icon: <Sparkles className="w-5 h-5" />, color: 'bg-purple-500', activeBorder: 'border-purple-500', activeBg: 'bg-purple-500/10', activeText: 'text-purple-400' },
  { id: 'mythology', label: 'Mythology', icon: <Skull className="w-5 h-5" />, color: 'bg-red-500', activeBorder: 'border-red-500', activeBg: 'bg-red-500/10', activeText: 'text-red-400' },
  { id: 'historical', label: 'History', icon: <Trophy className="w-5 h-5" />, color: 'bg-amber-500', activeBorder: 'border-amber-500', activeBg: 'bg-amber-500/10', activeText: 'text-amber-400' },
  { id: 'machinery', label: 'Machinery', icon: <Cog className="w-5 h-5" />, color: 'bg-blue-500', activeBorder: 'border-blue-500', activeBg: 'bg-blue-500/10', activeText: 'text-blue-400' },
  { id: 'living things', label: 'Living Things', icon: <Cat className="w-5 h-5" />, color: 'bg-emerald-500', activeBorder: 'border-emerald-500', activeBg: 'bg-emerald-500/10', activeText: 'text-emerald-400' },
];

export default function App() {
  const [weight, setWeight] = useState<string>('');
  const [unit, setUnit] = useState<'kg' | 'lbs'>('kg');
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const comparisonTextRef = useRef<HTMLDivElement>(null);
  const comparisonContainerRef = useRef<HTMLDivElement>(null);

  // Dynamic font scaling for the UI
  React.useEffect(() => {
    if (result && (imageUrl || !imageLoading)) {
      const container = comparisonContainerRef.current;
      const text = comparisonTextRef.current;
      if (!container || !text) return;

      let size = imageUrl ? 22 : 36; // Slightly smaller start for image card
      text.style.fontSize = `${size}px`;
      
      // Use a small delay to ensure layout has settled
      const timeout = setTimeout(() => {
        // Force a reflow check
        while (text.scrollHeight > container.clientHeight && size > 8) {
          size -= 0.5;
          text.style.fontSize = `${size}px`;
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [result, imageUrl, imageLoading]);

  const handleCompare = async (selectedCategory: Category) => {
    if (!weight || isNaN(Number(weight))) {
      setError('Please enter a weight first!');
      return;
    }

    setCategory(selectedCategory);
    setLoading(true);
    setError(null);
    setResult(null);
    setImageUrl(null);
    setImageLoading(false);

    try {
      console.log(`Starting comparison for ${weight} ${unit} in ${selectedCategory}...`);
      const comparison = await getWeightComparison(Number(weight), unit, selectedCategory);
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
      if (err.message === "QUOTA_EXCEEDED_MINUTE") {
        setError("AI is resting between sets. Try again in a minute!");
      } else if (err.message === "QUOTA_EXCEEDED_DAY") {
        setError("The model hit its max reps for the day. Try again tomorrow!");
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
      }
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
        setTimeout(() => reject(new Error("IMAGE_TIMEOUT")), 60000)
      );

      const img = await Promise.race([imagePromise, timeoutPromise]) as string;
      setImageUrl(img);
      
      // If it's a data URL (Gemini), it's already "loaded"
      if (img.startsWith('data:')) {
        setImageLoading(false);
      }
      // For Pollinations URLs, the <img> onLoad will set loading to false
      
      confetti({
        particleCount: 50,
        spread: 50,
        origin: { y: 0.5 },
        colors: ['#10b981', '#3b82f6']
      });
    } catch (err: any) {
      console.error("Image generation failed or timed out:", err);
      if (err.message === "QUOTA_EXCEEDED_MINUTE") {
        setError("Sorry, our AI image generation is resting between sets. Try again in a minute!");
      } else if (err.message === "QUOTA_EXCEEDED_DAY") {
        setError("The model has hit its max reps for the day and is hitting the showers. Try again tomorrow!");
      } else if (err.message === "IMAGE_TIMEOUT") {
        setError("Image generation is taking a bit longer than usual. The gym is packed! Try again in a moment.");
      } else {
        setError("Failed to generate image. Try again?");
      }
      setImageLoading(false);
    }
  };

  const generateCardImage = async (): Promise<string | null> => {
    if (!result || !canvasRef.current) return null;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Set canvas size (1080x1440 for 4:3 portrait shareable card)
    canvas.width = 1080;
    canvas.height = 1440;

    // Background
    ctx.fillStyle = '#ffffff'; // white
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw neat border
    ctx.strokeStyle = '#f4f4f5'; // zinc-100
    ctx.lineWidth = 40;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

    const centerX = canvas.width / 2;

    const drawBranding = (y: number, fontSize: number, opacity: number = 1) => {
      ctx.font = `bold ${fontSize}px Inter`;
      ctx.textBaseline = 'top';
      const iWidth = ctx.measureText('i').width;
      const liftedWidth = ctx.measureText('Lifted').width;
      const totalWidth = iWidth + liftedWidth;
      const startX = centerX - totalWidth / 2;
      
      ctx.textAlign = 'left';
      ctx.globalAlpha = opacity;
      ctx.fillStyle = '#10b981'; // teal
      ctx.fillText('i', startX, y);
      ctx.fillStyle = '#000000'; // black
      ctx.fillText('Lifted', startX + iWidth, y);
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic'; // Reset
    };

    if (imageUrl) {
      // Load AI image
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageUrl;
      await new Promise((resolve) => (img.onload = resolve));

      drawBranding(60, 60); // Higher and appropriately sized

      // Draw Weight
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 80px Inter'; // Smaller weight
      ctx.fillText(`${weight} ${unit}`, centerX, 180); // Higher

      // Draw AI Image - Centered and contained
      const imgSize = 750; 
      const imgX = (canvas.width - imgSize) / 2;
      const imgY = 240; // Higher
      
      // Calculate aspect ratio for contain
      const imgAspect = img.width / img.height;
      let drawW, drawH, drawX, drawY;
      
      if (imgAspect > 1) {
        drawW = imgSize;
        drawH = imgSize / imgAspect;
        drawX = imgX;
        drawY = imgY + (imgSize - drawH) / 2;
      } else {
        drawW = imgSize * imgAspect;
        drawH = imgSize;
        drawX = imgX + (imgSize - drawW) / 2;
        drawY = imgY;
      }

      // Draw image with rounded corners (clipping)
      ctx.save();
      const radius = 40;
      ctx.beginPath();
      ctx.moveTo(imgX + radius, imgY);
      ctx.lineTo(imgX + imgSize - radius, imgY);
      ctx.quadraticCurveTo(imgX + imgSize, imgY, imgX + imgSize, imgY + radius);
      ctx.lineTo(imgX + imgSize, imgY + imgSize - radius);
      ctx.quadraticCurveTo(imgX + imgSize, imgY + imgSize, imgX + imgSize - radius, imgY + imgSize);
      ctx.lineTo(imgX + radius, imgY + imgSize);
      ctx.quadraticCurveTo(imgX, imgY + imgSize, imgX, imgY + imgSize - radius);
      ctx.lineTo(imgX, imgY + radius);
      ctx.quadraticCurveTo(imgX, imgY, imgX + radius, imgY);
      ctx.closePath();
      ctx.clip();
      
      // Fill background for the image area
      ctx.fillStyle = '#f9fafb';
      ctx.fill();
      
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();

      // Comparison Text Area - Scale to fit remaining space
      const textAreaY = imgY + imgSize + 40;
      const availableHeight = 1340 - textAreaY; // More conservative to avoid footer
      
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#10b981'; // emerald-500
      
      // Short text for share card: just the item
      const text = result.shortDescription;
      
      // Helper to wrap and scale text
      const wrapText = (txt: string, maxW: number) => {
        const words = txt.split(' ');
        const lines = [];
        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const width = ctx.measureText(currentLine + " " + word).width;
          if (width < maxW) {
            currentLine += " " + word;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        lines.push(currentLine);
        return lines;
      };

      let fontSize = 90;
      ctx.font = `bold ${fontSize}px Inter`;
      let lines = wrapText(text, 900);
      
      while ((lines.length * fontSize * 1.2 > availableHeight) && fontSize > 16) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px Inter`;
        lines = wrapText(text, 900);
      }

      const lineHeight = fontSize * 1.2;
      let currentY = textAreaY + (availableHeight - (lines.length * lineHeight)) / 2 + lineHeight / 2;

      lines.forEach(line => {
        ctx.fillText(line, centerX, currentY);
        currentY += lineHeight;
      });
      ctx.textBaseline = 'alphabetic'; // Reset

      // Footer
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '25px Inter';
      ctx.fillText('Generated by iLifted AI', centerX, 1380);
    } else {
      // TEXT ONLY VERSION
      drawBranding(80, 80); // Higher and appropriately sized

      // Main Weight - Scale to fit
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      let weightFontSize = 180; // Smaller weight
      ctx.font = `bold ${weightFontSize}px Inter`;
      while (ctx.measureText(`${weight} ${unit}`).width > 900 && weightFontSize > 100) {
        weightFontSize -= 10;
        ctx.font = `bold ${weightFontSize}px Inter`;
      }
      ctx.fillText(`${weight} ${unit}`, centerX, 250); // Higher
      
      // Divider
      ctx.beginPath();
      ctx.moveTo(centerX - 150, 350); // Higher
      ctx.lineTo(centerX + 150, 350);
      ctx.strokeStyle = '#10b981'; // teal divider
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Comparison - Scale to fit central area
      const textAreaY = 450; // Higher
      const availableHeight = 1340 - textAreaY; // More conservative
      
      ctx.fillStyle = '#10b981'; // emerald-500
      ctx.textBaseline = 'middle';
      const text = result.shortDescription;
      
      const wrapText = (txt: string, maxW: number) => {
        const words = txt.split(' ');
        const lines = [];
        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const width = ctx.measureText(currentLine + " " + word).width;
          if (width < maxW) {
            currentLine += " " + word;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        lines.push(currentLine);
        return lines;
      };

      let fontSize = 140;
      ctx.font = `bold ${fontSize}px Inter`;
      let lines = wrapText(text, 900);
      
      while ((lines.length * fontSize * 1.2 > availableHeight) && fontSize > 24) {
        fontSize -= 5;
        ctx.font = `bold ${fontSize}px Inter`;
        lines = wrapText(text, 900);
      }

      const lineHeight = fontSize * 1.2;
      let currentY = textAreaY + (availableHeight - (lines.length * lineHeight)) / 2 + lineHeight / 2;

      lines.forEach(line => {
        ctx.fillText(line, centerX, currentY);
        currentY += lineHeight;
      });
      ctx.textBaseline = 'alphabetic'; // Reset

      // Footer
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '30px Inter';
      ctx.fillText('Generated by iLifted AI', centerX, 1400);
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
    setCategory(null);
  };

  return (
    <div className="h-[100dvh] sm:h-[850px] sm:my-auto flex flex-col max-w-md mx-auto p-4 overflow-hidden bg-zinc-950 text-zinc-100 sm:rounded-[3rem] sm:border-[8px] sm:border-zinc-900 shadow-2xl relative">
      {/* Hidden canvas for card generation */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Loading Overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center"
          >
            <motion.div
              animate={{ 
                y: [0, -40, 0],
                rotate: [0, -5, 5, 0]
              }}
              transition={{ 
                duration: 1.5, 
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="mb-8"
            >
              <Dumbbell className="w-20 h-20 text-emerald-400" />
            </motion.div>
            <h3 className="text-xl font-black tracking-tight mb-2 text-emerald-400 uppercase">
              Calculating Gains...
            </h3>
            <p className="text-zinc-400 text-sm font-medium mb-6">
              Comparing your lift to the weight of the world.
            </p>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 30 }}
              className="text-zinc-600 text-xs italic"
            >
              "It's busy in here today, waiting to work in..."
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

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

      <main className="flex-1 flex flex-col justify-center min-h-0 pb-20">
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div
              key="input-form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex-1 flex flex-col justify-center space-y-12"
            >
              <div className="flex flex-col justify-center space-y-10">
                {/* Weight Input */}
                <section>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-3 text-center">
                    How much did you lift?
                  </label>
                  <div className="relative group max-w-[280px] mx-auto">
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
                      className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-2xl px-5 py-5 text-4xl font-display text-center focus:border-emerald-500 focus:outline-none transition-colors"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex bg-zinc-800 rounded-xl p-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setUnit('kg'); }}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold transition-all",
                          unit === 'kg' ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"
                        )}
                      >
                        KG
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setUnit('lbs'); }}
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
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-4 text-center">
                    Tap a category to compare
                  </label>
                  <div className="grid grid-cols-2 gap-3 max-w-[320px] mx-auto">
                    {CATEGORIES.map((cat, index) => {
                      const isSelected = category === cat.id;
                      const isSurprise = index === 0;
                      
                      return (
                        <motion.button
                          key={cat.id}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleCompare(cat.id)}
                          className={cn(
                            "flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left group relative overflow-hidden",
                            isSelected 
                              ? cn(cat.activeBorder, cat.activeBg) 
                              : "border-zinc-800 bg-zinc-900 hover:border-zinc-700",
                            isSurprise && "col-span-2 justify-center py-5",
                            isSurprise && !isSelected && "bg-zinc-900/50 hover:border-purple-500/30"
                          )}
                        >
                          <div className={cn(
                            "p-2.5 rounded-xl shrink-0 transition-all duration-300 group-hover:scale-110 relative z-10",
                            cat.color, 
                            "text-zinc-950 shadow-lg shadow-black/20"
                          )}>
                            {React.cloneElement(cat.icon as React.ReactElement, { className: "w-5 h-5" })}
                          </div>
                          <span className={cn(
                            "font-display uppercase tracking-wide leading-tight relative z-10 transition-colors",
                            isSurprise ? "text-base" : "text-sm",
                            isSelected ? cat.activeText : "text-zinc-100"
                          )}>
                            {cat.label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </section>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center"
                >
                  <p className="text-red-400 text-[10px] font-medium mb-2">
                    {error}
                  </p>
                  <button
                    onClick={() => handleCompare(category!)}
                    className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[9px] font-bold uppercase tracking-widest rounded-lg transition-colors"
                  >
                    Retry Lift
                  </button>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="result-view"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col min-h-0 space-y-4"
            >
              {/* Message Above Image */}
              <div className="px-2 text-center shrink-0">
                <h2 className="text-sm sm:text-base font-bold leading-tight text-zinc-100 text-balance">
                  {result.message}
                </h2>
              </div>

              {/* Result Card (UI View) - 4:3 Aspect Ratio */}
              <div className="flex-1 min-h-0 bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col mx-auto w-full max-w-[340px] aspect-[3/4] shrink relative border-[12px] border-white">
                <div className="flex-1 relative bg-white min-h-0 flex flex-col p-6 text-center">
                  {imageUrl ? (
                    <div className="flex-1 flex flex-col min-h-0 justify-between">
                      <div className="shrink-0 mb-1">
                        <div className="text-2xl font-black tracking-tighter mb-0">
                          <span className="text-emerald-500">i</span><span className="text-zinc-950">Lifted</span>
                        </div>
                        <div className="text-zinc-950 text-4xl font-black leading-none tracking-tighter">{weight} {unit}</div>
                      </div>

                      <div className="flex-[5] min-h-[200px] w-full flex items-center justify-center overflow-hidden rounded-2xl bg-zinc-50 border border-zinc-100">
                        <motion.img
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          src={imageUrl}
                          alt="Comparison"
                          className="w-full h-full object-contain p-2"
                          referrerPolicy="no-referrer"
                          onLoad={() => setImageLoading(false)}
                          onError={() => {
                            console.error("Image failed to load, falling back to text version");
                            setImageUrl(null);
                            setError("Image failed to load. Showing text version instead.");
                          }}
                        />
                      </div>

                      <div ref={comparisonContainerRef} className="flex-1 flex flex-col justify-center pt-2 min-h-0 overflow-hidden">
                        <div ref={comparisonTextRef} className="text-emerald-500 font-black leading-tight tracking-tight px-2 text-balance">
                          That's like lifting {result.shortDescription.charAt(0).toLowerCase() + result.shortDescription.slice(1)}!
                        </div>
                        <div className="text-zinc-400 text-[8px] font-bold uppercase tracking-widest mt-1 opacity-50 shrink-0">
                          Generated by iLifted AI
                        </div>
                      </div>
                    </div>
                  ) : imageLoading ? (
                    <div className="flex-1 w-full h-full flex flex-col items-center justify-center gap-4 p-4 text-center">
                      <div className="relative">
                        <RefreshCw className="w-12 h-12 text-emerald-500 animate-spin" />
                      </div>
                      <p className="text-zinc-500 font-mono text-[10px] uppercase tracking-widest font-bold">
                        Visualizing your strength...
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 w-full h-full flex flex-col items-center justify-between p-6 text-center bg-white">
                      <div className="text-3xl font-black tracking-tighter mb-1">
                        <span className="text-emerald-500">i</span><span className="text-zinc-950">Lifted</span>
                      </div>
                      
                      <div className="flex-1 flex flex-col justify-center w-full">
                        <div className="text-zinc-950 text-5xl font-black leading-none tracking-tighter break-words mb-4">{weight} {unit}</div>
                        <div className="w-20 h-2 bg-emerald-500 rounded-full mx-auto mb-6" />
                        <div className="text-emerald-500 text-2xl font-black leading-tight tracking-tight text-balance">
                          That's like lifting {result.shortDescription.charAt(0).toLowerCase() + result.shortDescription.slice(1)}!
                        </div>
                      </div>

                      <div className="text-zinc-300 text-[10px] font-bold uppercase tracking-widest pt-4">
                        Generated by iLifted AI
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Show Me Button (Outside Card) */}
              {!imageUrl && !imageLoading && (
                <div className="px-4 py-2 space-y-2">
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center"
                    >
                      <p className="text-red-400 text-[10px] font-medium mb-2">
                        {error}
                      </p>
                      <button
                        onClick={handleGenerateImage}
                        className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[9px] font-bold uppercase tracking-widest rounded-lg transition-colors"
                      >
                        Retry Image
                      </button>
                    </motion.div>
                  )}
                  <button
                    onClick={handleGenerateImage}
                    className="relative w-full group overflow-hidden rounded-xl p-[2px] transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {/* Chasing Glow Background */}
                    <div className="absolute inset-[-1000%] animate-rotate bg-[conic-gradient(from_90deg_at_50%_50%,#10b981_0%,#3b82f6_25%,#10b981_50%,#3b82f6_75%,#10b981_100%)] opacity-40" />
                    
                    <div className="relative flex items-center justify-center gap-2 bg-zinc-900 rounded-[10px] py-3 px-6 transition-colors group-hover:bg-zinc-800">
                      <Sparkles className="w-4 h-4 text-emerald-500" />
                      <span className="text-zinc-100 text-sm font-display uppercase tracking-widest">Show me!</span>
                      <span className="text-zinc-500 text-[8px] font-mono uppercase tracking-widest ml-1 opacity-50">AI Visual</span>
                    </div>
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 w-full shrink-0 pt-1">
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 text-[10px] font-display uppercase tracking-widest py-2.5 rounded-xl hover:bg-white transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  Share
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-2 bg-zinc-800 text-zinc-100 text-[10px] font-display uppercase tracking-widest py-2.5 rounded-xl hover:bg-zinc-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save
                </button>
              </div>

              <div className="flex justify-center shrink-0">
                <button
                  onClick={reset}
                  className="flex items-center gap-2 text-zinc-500 text-[9px] font-display uppercase tracking-widest py-1 hover:text-zinc-100 transition-colors"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Try Another Lift
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-2 text-center shrink-0">
        <p className="text-[8px] font-mono tracking-[0.2em] text-zinc-600">
          Powered by Gemini AI • iLifted v1.5
        </p>
      </footer>
    </div>
  );
}
