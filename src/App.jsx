
import { useEffect, useMemo, useRef, useState } from "react";

const CANVAS_W = 900;
const CANVAS_H = 320;
const GROUND_Y = 255;
const MOAI_W = 54;
const MOAI_H = 72;
const PLAYER_X = 90;
const GRAVITY = 0.7;
const JUMP_VELOCITY = -13;
const BASE_SCROLL = 5;
const POWERUP_SIZE = 22;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export default function App() {
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem("moai_high_score") || 0);
  });
  const [shieldActive, setShieldActive] = useState(false);
  const [slowMoActive, setSlowMoActive] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  const stateRef = useRef({
    player: {
      x: PLAYER_X,
      y: GROUND_Y - MOAI_H,
      w: MOAI_W,
      h: MOAI_H,
      vy: 0,
      onGround: true,
      blink: 0,
    },
    obstacles: [],
    powerups: [],
    stars: [],
    clouds: [],
    coins: [],
    particles: [],
    frame: 0,
    scroll: BASE_SCROLL,
    spawnTimer: 0,
    powerupTimer: 0,
    coinTimer: 0,
    score: 0,
    shieldUntil: 0,
    slowMoUntil: 0,
  });

  const audio = useMemo(() => {
    if (typeof window === "undefined") return null;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const makeTone = (freq, duration, type = "sine", gainValue = 0.05) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = gainValue;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    };

    const playJump = () => {
      if (!soundOn || ctx.state === "closed") return;
      makeTone(420, 0.08, "triangle", 0.04);
      makeTone(630, 0.06, "triangle", 0.025);
    };

    const playCoin = () => {
      if (!soundOn || ctx.state === "closed") return;
      makeTone(880, 0.06, "sine", 0.04);
      makeTone(1320, 0.09, "sine", 0.03);
    };

    const playHit = () => {
      if (!soundOn || ctx.state === "closed") return;
      makeTone(120, 0.15, "sawtooth", 0.05);
      makeTone(80, 0.2, "square", 0.03);
    };

    const playPower = () => {
      if (!soundOn || ctx.state === "closed") return;
      makeTone(520, 0.08, "triangle", 0.04);
      makeTone(780, 0.08, "triangle", 0.04);
      makeTone(1040, 0.12, "triangle", 0.03);
    };

    const playBackground = () => {
      if (!soundOn || ctx.state === "closed") return;
      const now = ctx.currentTime;
      const notes = [220, 277.18, 329.63, 440, 329.63, 277.18];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = 0.012;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.38);
        osc.stop(now + i * 0.38 + 0.33);
      });
    };

    return { ctx, playJump, playCoin, playHit, playPower, playBackground };
  }, [soundOn]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("moai_high_score", String(highScore));
    }
  }, [highScore]);

  useEffect(() => {
    const initScene = () => {
      const s = stateRef.current;
      s.player = {
        x: PLAYER_X,
        y: GROUND_Y - MOAI_H,
        w: MOAI_W,
        h: MOAI_H,
        vy: 0,
        onGround: true,
        blink: 0,
      };
      s.obstacles = [];
      s.powerups = [];
      s.coins = [];
      s.particles = [];
      s.frame = 0;
      s.scroll = BASE_SCROLL;
      s.spawnTimer = 0;
      s.powerupTimer = 140;
      s.coinTimer = 40;
      s.score = 0;
      s.shieldUntil = 0;
      s.slowMoUntil = 0;
      setScore(0);
      setShieldActive(false);
      setSlowMoActive(false);
      setGameOver(false);
    };

    initScene();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const wrap = canvasWrapRef.current;
      if (!wrap) return;

      const width = wrap.clientWidth;
      const height = Math.max(220, Math.round((width * CANVAS_H) / CANVAS_W));

      canvas.style.width = "100%";
      canvas.style.height = `${height}px`;
    };

    resize();

    const ro = new ResizeObserver(resize);
    if (canvasWrapRef.current) ro.observe(canvasWrapRef.current);
    window.addEventListener("resize", resize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const drawRoundedRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const drawMoai = (p) => {
      const x = p.x;
      const y = p.y;
      ctx.save();

      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(x + p.w * 0.52, GROUND_Y + 10, 24, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      const grad = ctx.createLinearGradient(x, y, x + p.w, y + p.h);
      grad.addColorStop(0, "#6f5d51");
      grad.addColorStop(0.5, "#8d7968");
      grad.addColorStop(1, "#4f433b");
      ctx.fillStyle = grad;
      drawRoundedRect(x + 5, y + 2, p.w - 10, p.h - 2, 16);
      ctx.fill();

      ctx.fillStyle = "#a08b79";
      drawRoundedRect(x + 9, y, p.w - 18, 14, 7);
      ctx.fill();

      ctx.fillStyle = "#5b4a40";
      drawRoundedRect(x + 16, y + 12, p.w - 32, 39, 11);
      ctx.fill();

      ctx.fillStyle = "#201a17";
      ctx.beginPath();
      ctx.arc(x + 19, y + 28, 2.6, 0, Math.PI * 2);
      ctx.arc(x + p.w - 19, y + 28, 2.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#2d241f";
      ctx.beginPath();
      ctx.moveTo(x + p.w * 0.5, y + 26);
      ctx.lineTo(x + p.w * 0.5 - 7, y + 44);
      ctx.lineTo(x + p.w * 0.5 + 7, y + 44);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#281f1a";
      drawRoundedRect(x + 16, y + 49, p.w - 32, 9, 4);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,215,130,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 18);
      ctx.lineTo(x + 17, y + 18);
      ctx.moveTo(x + p.w - 17, y + 18);
      ctx.lineTo(x + p.w - 12, y + 18);
      ctx.moveTo(x + 13, y + 58);
      ctx.lineTo(x + 21, y + 58);
      ctx.moveTo(x + p.w - 21, y + 58);
      ctx.lineTo(x + p.w - 13, y + 58);
      ctx.stroke();

      const pulse = 0.5 + 0.5 * Math.sin(p.blink * 0.2);
      ctx.fillStyle = `rgba(255, 200, 76, ${0.25 + pulse * 0.35})`;
      ctx.beginPath();
      ctx.arc(x + p.w * 0.5, y + 60, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const drawObstacle = (o) => {
      ctx.save();
      const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
      grad.addColorStop(0, "#2b1812");
      grad.addColorStop(1, "#7b4f26");
      ctx.fillStyle = grad;
      drawRoundedRect(o.x, o.y, o.w, o.h, 10);
      ctx.fill();

      ctx.fillStyle = o.type === "obelisk" ? "#caa76e" : "#e2b85f";
      if (o.type === "obelisk") {
        ctx.beginPath();
        ctx.moveTo(o.x + o.w * 0.5, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h * 0.18);
        ctx.lineTo(o.x + o.w * 0.78, o.y + o.h);
        ctx.lineTo(o.x + o.w * 0.22, o.y + o.h);
        ctx.lineTo(o.x, o.y + o.h * 0.18);
        ctx.closePath();
        ctx.fill();
      } else {
        drawRoundedRect(o.x, o.y + 6, o.w, o.h - 6, 7);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.strokeRect(o.x + 5, o.y + 13, o.w - 10, 2);
        ctx.strokeRect(o.x + 5, o.y + 26, o.w - 10, 2);
      }
      ctx.restore();
    };

    const drawCoin = (c) => {
      ctx.save();
      const pulse = 0.7 + 0.3 * Math.sin((stateRef.current.frame + c.spin) * 0.2);
      ctx.shadowBlur = 14;
      ctx.shadowColor = "rgba(255, 209, 102, 0.6)";
      ctx.fillStyle = `rgba(255, 209, 102, ${0.9 * pulse})`;
      ctx.beginPath();
      ctx.arc(c.x + c.r, c.y + c.r, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(88, 56, 0, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x + c.r, c.y + c.r, c.r - 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(88, 56, 0, 0.75)";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("◈", c.x + c.r, c.y + c.r + 0.5);
      ctx.restore();
    };

    const drawPowerup = (p) => {
      ctx.save();
      const glow = p.type === "shield" ? "rgba(112, 235, 255, 0.75)" : "rgba(179, 121, 255, 0.75)";
      ctx.shadowBlur = 18;
      ctx.shadowColor = glow;
      ctx.fillStyle = p.type === "shield" ? "#7ef1ff" : "#c79aff";
      ctx.beginPath();
      ctx.arc(p.x + p.r, p.y + p.r, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(20, 14, 28, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x + p.r, p.y + p.r, p.r - 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(20, 14, 28, 0.8)";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.type === "shield" ? "🛡" : "⏳", p.x + p.r, p.y + p.r + 0.5);
      ctx.restore();
    };

    const drawParticle = (p) => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const spawnObstacle = () => {
      const s = stateRef.current;
      const type = Math.random() < 0.5 ? "totem" : "obelisk";
      const h = type === "totem" ? 48 + Math.random() * 24 : 55 + Math.random() * 42;
      const w = type === "totem" ? 24 + Math.random() * 18 : 24 + Math.random() * 16;
      s.obstacles.push({
        x: CANVAS_W + 20,
        y: GROUND_Y - h,
        w,
        h,
        type,
      });
    };

    const spawnCoin = () => {
      const s = stateRef.current;
      const y = 120 + Math.random() * 95;
      s.coins.push({ x: CANVAS_W + 20, y, r: 11, spin: Math.random() * 10 });
    };

    const spawnPowerup = () => {
      const s = stateRef.current;
      const type = Math.random() < 0.6 ? "shield" : "slow";
      const y = 100 + Math.random() * 110;
      s.powerups.push({ x: CANVAS_W + 20, y, r: POWERUP_SIZE / 2, type });
    };

    const burst = (x, y, color, amount = 12) => {
      const s = stateRef.current;
      for (let i = 0; i < amount; i++) {
        const a = (Math.PI * 2 * i) / amount + Math.random() * 0.35;
        const speed = 1.5 + Math.random() * 3.5;
        s.particles.push({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed - 1.5,
          r: 1.5 + Math.random() * 2.6,
          life: 1,
          decay: 0.02 + Math.random() * 0.02,
          color,
        });
      }
    };

    const drawBackground = () => {
      const s = stateRef.current;
      const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      sky.addColorStop(0, "#120a2a");
      sky.addColorStop(0.6, "#1e1240");
      sky.addColorStop(1, "#120a2a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      s.stars.forEach((st) => {
        ctx.save();
        ctx.globalAlpha = st.a;
        ctx.fillStyle = "#fff2b3";
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#ffd86b";
      ctx.beginPath();
      ctx.arc(760, 70, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = "#85f0ff";
      for (let i = 0; i < 5; i++) {
        const x = 160 + i * 170 - ((s.frame * 0.25) % 170);
        const y = 50 + (i % 2) * 32;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 24, y - 10);
        ctx.lineTo(x + 44, y + 3);
        ctx.lineTo(x + 62, y - 8);
        ctx.stroke();
      }
      ctx.restore();

      ctx.fillStyle = "#281642";
      ctx.beginPath();
      ctx.moveTo(0, 205);
      ctx.lineTo(90, 150);
      ctx.lineTo(170, 205);
      ctx.lineTo(260, 135);
      ctx.lineTo(350, 205);
      ctx.lineTo(460, 155);
      ctx.lineTo(580, 205);
      ctx.lineTo(690, 145);
      ctx.lineTo(810, 205);
      ctx.lineTo(CANVAS_W, 175);
      ctx.lineTo(CANVAS_W, 205);
      ctx.closePath();
      ctx.fill();

      const ground = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
      ground.addColorStop(0, "#2d163a");
      ground.addColorStop(1, "#140c1d");
      ctx.fillStyle = ground;
      ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

      ctx.strokeStyle = "rgba(255, 154, 61, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y + 1);
      ctx.lineTo(CANVAS_W, GROUND_Y + 1);
      ctx.stroke();
    };

    const jump = () => {
      const s = stateRef.current;
      if (!running || gameOver) return;
      if (s.player.onGround) {
        s.player.vy = JUMP_VELOCITY;
        s.player.onGround = false;
        burst(s.player.x + s.player.w / 2, s.player.y + s.player.h, "rgba(255, 214, 102, 0.8)", 10);
        audio.playJump();
      }
    };

    const loop = (ts) => {
      const s = stateRef.current;
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = clamp((ts - lastTsRef.current) / 16.6667, 0.5, 1.6);
      lastTsRef.current = ts;

      if (running && !gameOver) {
        s.frame += 1;

        const scoreStep = 0.05;
        s.score += scoreStep * dt;
        const currentScore = Math.floor(s.score);
        setScore(currentScore);
        if (currentScore > highScore) setHighScore(currentScore);

        const now = performance.now();
        const shieldLeft = s.shieldUntil > now;
        const slowLeft = s.slowMoUntil > now;
        setShieldActive(shieldLeft);
        setSlowMoActive(slowLeft);

        const targetScroll = BASE_SCROLL + Math.min(5, currentScore / 80);
        s.scroll = slowLeft ? targetScroll * 0.55 : targetScroll;

        if (s.stars.length === 0) {
          for (let i = 0; i < 70; i++) {
            s.stars.push({ x: Math.random() * CANVAS_W, y: Math.random() * 130, r: Math.random() * 1.8 + 0.4, a: Math.random() * 0.8 + 0.2 });
          }
          for (let i = 0; i < 4; i++) {
            s.clouds.push({ x: Math.random() * CANVAS_W, y: 35 + Math.random() * 80, w: 70 + Math.random() * 90, h: 22 + Math.random() * 16, speed: 0.3 + Math.random() * 0.3 });
          }
        }

        s.stars.forEach((st, i) => {
          st.x -= 0.04 * dt;
          st.a += Math.sin((s.frame + i) * 0.03) * 0.002;
          if (st.x < -5) st.x = CANVAS_W + 5;
        });

        s.clouds.forEach((cl) => {
          cl.x -= cl.speed * dt;
          if (cl.x + cl.w < -20) {
            cl.x = CANVAS_W + 20;
            cl.y = 25 + Math.random() * 95;
          }
        });

        s.player.vy += GRAVITY * dt;
        s.player.y += s.player.vy * dt;
        s.player.blink += 1 * dt;

        if (s.player.y >= GROUND_Y - s.player.h) {
          s.player.y = GROUND_Y - s.player.h;
          s.player.vy = 0;
          s.player.onGround = true;
        }

        s.spawnTimer -= dt;
        if (s.spawnTimer <= 0) {
          spawnObstacle();
          s.spawnTimer = Math.max(35, 85 - currentScore / 8) + Math.random() * 22;
        }

        s.coinTimer -= dt;
        if (s.coinTimer <= 0) {
          spawnCoin();
          s.coinTimer = 18 + Math.random() * 20;
        }

        s.powerupTimer -= dt;
        if (s.powerupTimer <= 0) {
          if (Math.random() < 0.75) spawnPowerup();
          s.powerupTimer = 180 + Math.random() * 140;
        }

        s.obstacles.forEach((o) => (o.x -= s.scroll * dt));
        s.powerups.forEach((p) => (p.x -= s.scroll * dt));
        s.coins.forEach((c) => (c.x -= s.scroll * dt));
        s.particles.forEach((p) => {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 0.08 * dt;
          p.life -= p.decay * dt;
        });

        s.obstacles = s.obstacles.filter((o) => o.x + o.w > -30);
        s.powerups = s.powerups.filter((p) => p.x + p.r * 2 > -20);
        s.coins = s.coins.filter((c) => c.x + c.r * 2 > -20);
        s.particles = s.particles.filter((p) => p.life > 0);

        s.coins = s.coins.filter((c) => {
          const hit = rectsIntersect(
            { x: s.player.x, y: s.player.y, w: s.player.w, h: s.player.h },
            { x: c.x, y: c.y, w: c.r * 2, h: c.r * 2 }
          );
          if (hit) {
            s.score += 12;
            setScore(Math.floor(s.score));
            burst(c.x + c.r, c.y + c.r, "rgba(255, 220, 100, 0.95)", 14);
            audio.playCoin();
            return false;
          }
          return true;
        });

        s.powerups = s.powerups.filter((p) => {
          const hit = rectsIntersect(
            { x: s.player.x, y: s.player.y, w: s.player.w, h: s.player.h },
            { x: p.x, y: p.y, w: p.r * 2, h: p.r * 2 }
          );
          if (hit) {
            if (p.type === "shield") {
              s.shieldUntil = performance.now() + 7000;
              setShieldActive(true);
            } else {
              s.slowMoUntil = performance.now() + 6500;
              setSlowMoActive(true);
            }
            burst(p.x + p.r, p.y + p.r, p.type === "shield" ? "rgba(120, 240, 255, 0.95)" : "rgba(202, 148, 255, 0.95)", 18);
            audio.playPower();
            return false;
          }
          return true;
        });

        for (const o of s.obstacles) {
          if (
            rectsIntersect(
              { x: s.player.x, y: s.player.y, w: s.player.w, h: s.player.h },
              { x: o.x + 4, y: o.y + 4, w: o.w - 8, h: o.h - 8 }
            )
          ) {
            if (shieldLeft) {
              s.shieldUntil = 0;
              setShieldActive(false);
              burst(s.player.x + s.player.w / 2, s.player.y + s.player.h / 2, "rgba(120, 240, 255, 0.95)", 20);
              audio.playHit();
              s.obstacles = s.obstacles.filter((other) => other !== o);
              break;
            }
            burst(s.player.x + s.player.w / 2, s.player.y + s.player.h / 2, "rgba(255, 92, 92, 0.95)", 26);
            audio.playHit();
            setGameOver(true);
            setRunning(false);
            if (currentScore > highScore) setHighScore(currentScore);
            break;
          }
        }
      }

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawBackground();

      const s2 = stateRef.current;

      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#ad9cff";
      s2.clouds.forEach((cl) => {
        ctx.beginPath();
        ctx.ellipse(cl.x, cl.y, cl.w * 0.23, cl.h * 0.55, 0, 0, Math.PI * 2);
        ctx.ellipse(cl.x + cl.w * 0.25, cl.y - 6, cl.w * 0.2, cl.h * 0.45, 0, 0, Math.PI * 2);
        ctx.ellipse(cl.x + cl.w * 0.5, cl.y, cl.w * 0.28, cl.h * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      s2.coins.forEach(drawCoin);
      s2.powerups.forEach(drawPowerup);
      s2.obstacles.forEach(drawObstacle);
      s2.particles.forEach(drawParticle);
      drawMoai(s2.player);

      if (s2.shieldUntil > performance.now()) {
        ctx.save();
        ctx.strokeStyle = "rgba(120, 240, 255, 0.85)";
        ctx.lineWidth = 3;
        ctx.shadowBlur = 20;
        ctx.shadowColor = "rgba(120, 240, 255, 0.8)";
        ctx.beginPath();
        ctx.ellipse(s2.player.x + s2.player.w / 2, s2.player.y + s2.player.h / 2, 38, 48, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 20px system-ui, sans-serif";
      ctx.fillText(`Score: ${score}`, 20, 30);
      ctx.fillText(`High: ${highScore}`, 20, 54);
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillStyle = shieldActive ? "#8ff6ff" : "rgba(255,255,255,0.75)";
      ctx.fillText(`Shield: ${shieldActive ? "ACTIVE" : "off"}`, 20, 78);
      ctx.fillStyle = slowMoActive ? "#d6a2ff" : "rgba(255,255,255,0.75)";
      ctx.fillText(`Slow Mo: ${slowMoActive ? "ACTIVE" : "off"}`, 20, 98);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText("Space / Tap to jump", CANVAS_W - 180, 30);
      ctx.fillText("Collect ◈ coins and power-ups", CANVAS_W - 250, 54);
      ctx.restore();

      if (gameOver) {
        ctx.save();
        ctx.fillStyle = "rgba(9, 6, 18, 0.72)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = "#fff2d1";
        ctx.textAlign = "center";
        ctx.font = "900 44px system-ui, sans-serif";
        ctx.fillText("THE MOAI HAS FALLEN", CANVAS_W / 2, 128);
        ctx.font = "600 20px system-ui, sans-serif";
        ctx.fillText(`Score: ${score}  •  High Score: ${highScore}`, CANVAS_W / 2, 165);
        ctx.fillText("Press Restart or tap the screen", CANVAS_W / 2, 198);
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, gameOver, score, highScore, shieldActive, slowMoActive, soundOn, audio]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gameArea = canvasWrapRef.current;
    if (!canvas || !gameArea) return;

    const onKeyDown = (e) => {
      if (e.code === "Space") {
        e.preventDefault();

        if (gameOver) {
          resetGame();
          return;
        }

        if (!running) {
          setRunning(true);
          return;
        }

        const s = stateRef.current;
        if (s.player.onGround) {
          s.player.vy = JUMP_VELOCITY;
          s.player.onGround = false;
          audio.playJump();
        }
      }

      if (e.code === "KeyR") resetGame();
      if (e.code === "KeyM") setSoundOn((v) => !v);
    };

    const onPointerDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (gameOver) {
        resetGame();
        return;
      }

      if (!running) {
        setRunning(true);
        return;
      }

      const s = stateRef.current;
      if (s.player.onGround) {
        s.player.vy = JUMP_VELOCITY;
        s.player.onGround = false;
        audio.playJump();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    gameArea.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      gameArea.removeEventListener("pointerdown", onPointerDown);
    };
  }, [running, gameOver, audio]);

  const resetGame = () => {
    const s = stateRef.current;
    s.player = {
      x: PLAYER_X,
      y: GROUND_Y - MOAI_H,
      w: MOAI_W,
      h: MOAI_H,
      vy: 0,
      onGround: true,
      blink: 0,
    };
    s.obstacles = [];
    s.powerups = [];
    s.coins = [];
    s.particles = [];
    s.frame = 0;
    s.scroll = BASE_SCROLL;
    s.spawnTimer = 0;
    s.powerupTimer = 120;
    s.coinTimer = 30;
    s.score = 0;
    s.shieldUntil = 0;
    s.slowMoUntil = 0;
    setScore(0);
    setShieldActive(false);
    setSlowMoActive(false);
    setGameOver(false);
    setRunning(true);
  };

  const toggleSound = async () => {
    if (audio?.ctx && audio.ctx.state === "suspended") {
      await audio.ctx.resume();
      audio.playBackground();
    }
    setSoundOn((v) => !v);
  };

  const startGame = async () => {
    if (audio?.ctx && audio.ctx.state === "suspended") {
      await audio.ctx.resume();
      audio.playBackground();
    }
    if (gameOver) resetGame();
    else setRunning(true);
  };

  return (
    <div className="min-h-screen bg-[#090512] text-white px-3 sm:px-4 md:px-6 py-4 md:py-6">
      <div className="w-full max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.35em] text-cyan-300/80">Crypto Mythic Runner</p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight">MOAI Vault Dash</h1>
            <p className="text-white/70 max-w-2xl text-sm sm:text-base leading-6">
              A stone guardian sprints through a neon ruin of ancient tokens, sacred coins, and mythic power.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <button onClick={startGame} className="w-full sm:w-auto rounded-2xl px-4 py-3 bg-cyan-400 text-black font-bold shadow-lg shadow-cyan-400/20">
              {gameOver ? "Restart Run" : running ? "Running" : "Start Run"}
            </button>
            <button onClick={resetGame} className="w-full sm:w-auto rounded-2xl px-4 py-3 bg-white/10 font-semibold backdrop-blur">
              Reset
            </button>
            <button onClick={toggleSound} className="w-full sm:w-auto rounded-2xl px-4 py-3 bg-white/10 font-semibold backdrop-blur">
              Sound: {soundOn ? "On" : "Off"}
            </button>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] items-start">
          <div className="min-w-0 rounded-[24px] sm:rounded-[28px] p-3 bg-gradient-to-b from-white/10 to-white/5 shadow-2xl shadow-black/30 border border-white/10">
            <div ref={canvasWrapRef} className="w-full overflow-hidden rounded-[18px] sm:rounded-[22px] bg-black">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="block w-full h-auto touch-none select-none"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, touchAction: "none" }}
              />
            </div>
          </div>
          <div className="min-w-0 space-y-4 rounded-[24px] sm:rounded-[28px] p-4 sm:p-5 bg-white/5 border border-white/10 backdrop-blur-md"></div>
        </div>
        <div className="space-y-4 rounded-[28px] p-5 bg-white/5 border border-white/10 backdrop-blur-md">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Status</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between"><span>Score</span><span className="font-bold">{score}</span></div>
              <div className="flex items-center justify-between"><span>High Score</span><span className="font-bold">{highScore}</span></div>
              <div className="flex items-center justify-between"><span>Shield</span><span className={shieldActive ? "text-cyan-300 font-bold" : "text-white/60"}>{shieldActive ? "Active" : "Off"}</span></div>
              <div className="flex items-center justify-between"><span>Slow Mo</span><span className={slowMoActive ? "text-purple-300 font-bold" : "text-white/60"}>{slowMoActive ? "Active" : "Off"}</span></div>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Controls</p>
            <p className="mt-2 text-sm text-white/70 leading-6">
              Press <span className="font-bold text-white">Space</span> or tap to jump. Collect <span className="font-bold text-yellow-300">coins</span>,
              <span className="font-bold text-cyan-300"> shield</span>, and <span className="font-bold text-purple-300">slow time</span> relics.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Vibe</p>
            <p className="mt-2 text-sm text-white/70 leading-6">
              Ancient stone, glowing gold, cosmic ruins, and a sacred runner protecting a vault of lost crypto.
            </p>
          </div>

          <div className="rounded-2xl bg-black/30 p-4 border border-white/10">
            <p className="text-sm font-semibold text-white">Tips</p>
            <p className="mt-2 text-sm text-white/70 leading-6">
              Shields block one hit. Slow-mo makes the ruins easier to read. Coins boost your score fast.
            </p>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-white/40">MOAI Vault Dash • crypto-themed mythic runner</p>
    </div>
  );
}
