const siteData = {
  name: "Welcome to Yicheng Li's Website!",
  tagline: 'NLP & Physics @ Peking University',
  contact: {
    email: 'yichengli318@gmail.com',
    linkedin: 'https://www.linkedin.com/in/yicheng-li-733790395/'
  },
  sections: [
    {
      id: 'education',
      title: 'Education',
      items: [
        {
          title: 'Peking University · Beijing, China',
          meta: 'Sept. 2021 – July 2025',
          bullets: [
            'B.S. in Physics',
            'Double Degree B.A. in Language and Literature'
          ]
        }
      ]
    },
    {
      id: 'internship',
      title: 'Professional Internship',
      items: [
        {
          title: 'ByteDance',
          role: 'Intern Model Security Testing Engineer',
          location: 'Beijing, China',
          time: 'May 2025 - Aug. 2025',
          bullets: [
            "Conducted security testing on ByteDance's latest language models, focusing on injection attacks, and developed domain-specific test cases and automated attack scripts to evaluate model robustness",
            'Analyzed model behavior under attack conditions, documented vulnerabilities, and collaborated with LLM developing teams to propose improvements'
          ]
        }
      ]
    },
    {
      id: 'research',
      title: 'Research Experience',
      items: [
        {
          title: 'Physics Specialized Large Language Model (LLM)',
          role: 'Graduate Thesis under Prof. Siguang Wang, Peking University',
          location: 'Beijing, China',
          time: 'Oct. 2024 - May 2025',
          bullets: [
            'Built a comprehensive physics knowledge dataset, including textbooks, latest papers on ArXiv, and public databases, and cleaned the data into an accessible format.',
            'Fine-tuned the Llama-3.1-8B model for physics domain knowledge using the LoRA technique with Unsloth.',
            'Organized a Retrieval Augmented Generation (RAG) framework, performed database chunking with a sliding window approach, embedded knowledge using SBERT for vectorization, and built a vector database with FAISS, enabling efficient retrieval of relevant information.',
            'Tested on multiple tasks, including the GPQA benchmark, literature summarization, and paper evaluation, achieving performance comparable to Llama-2-70B model with the 8B model I developed.'
          ]
        },
        {
          title: 'Graph-based RAG',
          role: 'Research Assistant under Prof. Chao Huang, Hong Kong University',
          location: 'Hong Kong',
          time: 'May 2024 - Oct. 2024',
          bullets: [
            'Developed a new graph-based RAG structure under the guidance of PhD students, which uses local models to detect entities and their relationships within the database, storing them as nodes and edges in a graph and labeling with key-value pairs for efficient information retrieval.',
            'Tested on the dimensions of comprehensiveness and cost, demonstrating that this new structure outperforms traditional methods significantly.'
          ]
        },
        {
          title: 'Modification of Neural Networks for Computational Physics',
          role: 'Research Assistant under Prof. Yong Xu, Tsinghua University',
          location: 'Beijing, China',
          time: 'Mar. 2023 - June 2023',
          bullets: [
            'Proved that traditional neural networks fail to provide correct Hamiltonians, an essential property of materials, when applied to crystals with degenerate energy bands.',
            'Proposed a new auto-differentiation algorithm based on linear algebra to accommodate over 80 elements from the periodic table, and implemented it in a more robust code using SciPy and JAX.',
            'Tested the algorithm on classical crystal configurations including GaN and GeS, showing advantages over traditional methods in terms of versatility and hardware tolerance.'
          ]
        }
      ]
    },
    {
      id: 'projects',
      title: 'Projects',
      items: [
        {
          title: 'Novel Multi-agent System for Coding',
          role: 'Course Project under Prof. Zhihong Deng, Peking University',
          location: 'Beijing, China',
          time: 'Dec. 2023 - Jan. 2024',
          bullets: [
            'Developed a multi-agent system  with integrated workflows optimized for coding tasks, through writing prompts, designing communication protocols, and defining agent behavior rules.',
            'Programmed a small game via this multi-agent system without human intervention, and presented it as a demonstration project in the NLP course.'
          ]
        }
      ]
    },
    {
      id: 'honors',
      title: 'Honors & Awards',
      items: [
        {
          title: 'Awards',
          bullets: [
            'Outstanding Academic Achievement Prize, Peking University · 2024',
            'Outstanding Academic Achievement Prize, Peking University · 2022',
            'UBIQUANT Scholarship, Peking University · 2022',
            'Gold Medal, 37th China Physics Olympiad · 2020'
          ]
        }
      ]
    }
  ],
  skills: {
    languages: ['Python', 'C', 'C++', 'MatLab', 'Mathematica', 'R', 'HTML', 'JavaScript'],
    tools: ['PyTorch', 'Transformers', 'Pandas', 'NumPy', 'SciPy', 'JAX', 'Unsloth', 'FAISS', 'NLPy', 'Scikit-learn', 'Matplotlib', 'Scrapy', 'BeautifulSoup4', 'Git', 'Linux', 'Docker', 'MySQL', 'Jupyter', 'LaTeX']
  },
  interests: ['Photography', 'Electric Guitar', 'Creative Writing', 'Workout'],
  languagesLabel: 'Native Chinese, bilingual proficiency in English'
};

const App = {
  data() {
    return {
      typedName: '',
      site: siteData,
      activeSkills: 'languages',
      activeExperience: 'research',
      _typeIndex: 0,
      _typeTimer: null,
      _observer: null,
      _canvas: null,
      _ctx: null,
      _mx: null,
      _my: null,
      _ps: [],
      _raf: 0
    };
  },
  computed: {
    filteredSections() {
      const hide = ['education','internship','research','projects','interests'];
      return this.site.sections.filter(s => !hide.includes(s.id));
    }
  },
  watch: {},
  mounted() {
    const seen = localStorage.getItem('firstVisitDone');
    if (!seen) {
      this.startNameTypewriter();
      localStorage.setItem('firstVisitDone', '1');
    } else {
      this.typedName = this.site.name;
    }
    this.initReveal();
    this.initParticles();
  },
  methods: {
    startNameTypewriter() {
      const full = this.site.name;
      this._typeTimer && clearInterval(this._typeTimer);
      this._typeIndex = 0;
      this.typedName = '';
      this._typeTimer = setInterval(() => {
        if (this._typeIndex <= full.length) {
          this.typedName = full.slice(0, this._typeIndex);
          this._typeIndex++;
        } else {
          clearInterval(this._typeTimer);
        }
      }, 40);
    },
    
    initReveal() {
      const els = document.querySelectorAll('.reveal');
      this._observer = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
      }, { threshold: 0.08 });
      els.forEach(el => this._observer.observe(el));
    },
    initParticles() {
      this._canvas = document.getElementById('bg');
      if (!this._canvas) return;
      this._ctx = this._canvas.getContext('2d');
      const resize = () => {
        this._canvas.width = window.innerWidth;
        this._canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('mousemove', (e) => {
        this._mx = e.clientX;
        this._my = e.clientY;
      });

      const count = Math.floor((window.innerWidth + window.innerHeight) / 18);
      this._ps = Array.from({ length: count }).map(() => {
        const followRatio = 1/101;
        const follow = Math.random() < followRatio;
        return {
          x: Math.random() * this._canvas.width,
          y: Math.random() * this._canvas.height,
          vx: (Math.random() - 0.5) * 0.8,
          vy: (Math.random() - 0.5) * 0.8,
          r: 1.6 + Math.random() * 1.2,
          follow,
          maxSpeed: (follow ? 0.6 : 1.2) * 0.1
        };
      });

      const step = () => {
        const ctx = this._ctx;
        const W = this._canvas.width, H = this._canvas.height;
        ctx.clearRect(0, 0, W, H);
        const particleColor = getComputedStyle(document.documentElement).getPropertyValue('--particle').trim() || '#888888';
        ctx.fillStyle = particleColor;
        ctx.strokeStyle = particleColor + 'aa';
        ctx.lineWidth = 0.6;
        const mouseForceFollow = 0.00005 * 0.1;
        const wanderJitter = 0.05 * 0.1;
        const minDist = 10;

        for (let i = 0; i < this._ps.length; i++) {
          const p = this._ps[i];
          if (p.follow && this._mx !== null && this._my !== null) {
            const dxm = this._mx - p.x, dym = this._my - p.y;
            p.vx += dxm * mouseForceFollow;
            p.vy += dym * mouseForceFollow;
          } else {
            p.vx += (Math.random() - 0.5) * wanderJitter;
            p.vy += (Math.random() - 0.5) * wanderJitter;
          }
          p.vx = Math.max(-p.maxSpeed, Math.min(p.maxSpeed, p.vx));
          p.vy = Math.max(-p.maxSpeed, Math.min(p.maxSpeed, p.vy));
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }

        for (let i = 0; i < this._ps.length; i++) {
          for (let j = i + 1; j < this._ps.length; j++) {
            const a = this._ps[i], b = this._ps[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.hypot(dx, dy);
            if (d > 0 && d < minDist) {
              const push = (minDist - d) * 0.02;
              const nx = dx / d, ny = dy / d;
              a.vx += nx * push; a.vy += ny * push;
              b.vx -= nx * push; b.vy -= ny * push;
            }
          }
        }

        for (let i = 0; i < this._ps.length; i++) {
          for (let j = i + 1; j < this._ps.length; j++) {
            const a = this._ps[i], b = this._ps[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.hypot(dx, dy);
            if (d < 120) {
              ctx.globalAlpha = 1 - d / 120;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }
        }
        if (this._mx !== null && this._my !== null) {
          for (let i = 0; i < this._ps.length; i++) {
            const p = this._ps[i];
            const dm = Math.hypot(p.x - this._mx, p.y - this._my);
            if (dm < 140) {
              ctx.globalAlpha = 1 - dm / 140;
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(this._mx, this._my); ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }
        }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    },
    stopParticles() {
      cancelAnimationFrame(this._raf);
      const ctx = this._ctx; const cvs = this._canvas;
      if (ctx && cvs) ctx.clearRect(0, 0, cvs.width, cvs.height);
    }
  }
};

Vue.createApp(App).mount('#app');