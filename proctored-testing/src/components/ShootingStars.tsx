'use client';

import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  angle: number;
  trail: number;
  active: boolean;
  reset: () => void;
}

export default function ShootingStars() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let animId: number;

    // Static background stars
    const staticStars: { x: number; y: number; r: number; alpha: number }[] = [];
    for (let i = 0; i < 250; i++) {
      staticStars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.2,
        alpha: 0.1 + Math.random() * 0.5,
      });
    }

    // Shooting star factory
    const createShootingStar = (): Star => {
      const star: Star = {
        x: 0, y: 0, length: 0, speed: 0, opacity: 0, angle: 0, trail: 0, active: false,
        reset() {
          this.x = Math.random() * width * 1.2;
          this.y = Math.random() * height * 0.4;
          this.length = 80 + Math.random() * 180;
          this.speed = 6 + Math.random() * 10;
          this.opacity = 0.7 + Math.random() * 0.3;
          this.angle = Math.PI / 4 + (Math.random() - 0.5) * 0.3;
          this.trail = 0;
          this.active = true;
        }
      };
      star.reset();
      star.x = Math.random() * width;
      star.y = Math.random() * height * 0.6;
      return star;
    };

    const shootingStars: Star[] = Array.from({ length: 8 }, createShootingStar);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Fill background
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      // Static stars
      staticStars.forEach((s) => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
        ctx.fill();
      });

      // Shooting stars
      shootingStars.forEach((star) => {
        if (!star.active) return;

        const tx = star.x + Math.cos(star.angle) * star.length;
        const ty = star.y + Math.sin(star.angle) * star.length;

        const grad = ctx.createLinearGradient(star.x, star.y, tx, ty);
        grad.addColorStop(0, `rgba(255,255,255,0)`);
        grad.addColorStop(0.3, `rgba(255,255,255,${star.opacity * 0.4})`);
        grad.addColorStop(1, `rgba(255,255,255,${star.opacity})`);

        ctx.beginPath();
        ctx.moveTo(star.x, star.y);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Head glow
        const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 4);
        glow.addColorStop(0, `rgba(255,255,255,${star.opacity})`);
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Move
        star.x += Math.cos(star.angle) * star.speed;
        star.y += Math.sin(star.angle) * star.speed;

        // Reset when off screen
        if (star.x > width + 200 || star.y > height + 200) {
          star.reset();
          star.x = Math.random() * width * 0.8;
          star.y = -50 + Math.random() * (height * 0.3) * -1;
        }
      });

      animId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="shooting-stars-canvas"
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
    />
  );
}
