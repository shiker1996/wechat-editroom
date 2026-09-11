const $ = (selector) => document.querySelector(selector);

const carouselSlides = [
  { type: 'video', image: './assets/ui-demo-cover.png', src: 'https://player.bilibili.com/player.html?isOutside=true&aid=117250979792750&bvid=BV1KjYj6GEJU&cid=41783987390&p=1', kicker: '01 / FULL WORKFLOW', title: '完整工作流教程视频', description: '从总览到热点、选题、编辑和公众号排版，直接看完一条真实链路' },
  { image: './assets/ui-dashboard.png', kicker: '02 / WORKSPACE', title: '总览 Dashboard', description: '批次、任务与产物一眼回到工作现场' },
  { image: './assets/ui-atlas.png', kicker: '03 / HOTSPOT ATLAS', title: '热点全景', description: '从信息源进入事件与候选选题' },
  { image: './assets/ui-editorial.png', kicker: '04 / EDITORIAL ROOM', title: 'AI 编辑会', description: '把角度、事实和风险放在同一张桌上' },
  { image: './assets/ui-editor.png', kicker: '05 / DRAFTING', title: '文章编辑器', description: '成稿、审阅和版本修订' },
  { image: './assets/ui-preview.png', kicker: '06 / DELIVERY', title: '公众号预览', description: '把文章推进到可交付 HTML' },
  { image: './assets/ui-cover.png', kicker: '07 / VISUALS', title: '视觉交付', description: '封面、配图和社交图文' }
];

function initCarousel() {
  const root = $('[data-carousel]');
  if (!root) return;
  const media = $('#carousel-media');
  const kicker = $('#carousel-kicker');
  const title = $('#carousel-title');
  const description = $('#carousel-description');
  const current = $('#carousel-current');
  const total = $('#carousel-total');
  const dots = $('.carousel-dots');
  const thumbs = $('.carousel-thumbs');
  let index = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 0;

  total.textContent = String(carouselSlides.length).padStart(2, '0');
  carouselSlides.forEach((slide, slideIndex) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'carousel-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `查看第 ${slideIndex + 1} 项内容：${slide.title}`);
    dot.addEventListener('click', () => show(slideIndex));
    dots.append(dot);

    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'carousel-thumb';
    thumb.setAttribute('role', 'tab');
    thumb.setAttribute('aria-label', `查看${slide.title}`);
    thumb.innerHTML = `<img src="${slide.image}" alt=""><span>${String(slideIndex + 1).padStart(2, '0')} ${slide.title}</span>`;
    thumb.addEventListener('click', () => show(slideIndex));
    thumbs.append(thumb);
  });

  function show(nextIndex) {
    index = (nextIndex + carouselSlides.length) % carouselSlides.length;
    const slide = carouselSlides[index];
    root.classList.add('is-switching');
    window.setTimeout(() => {
      media.replaceChildren();
      if (slide.type === 'video') {
        const iframe = document.createElement('iframe');
        iframe.src = slide.src;
        iframe.setAttribute('scrolling', 'no');
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allow', 'fullscreen');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.title = slide.title;
        media.append(iframe);
      } else {
        const image = document.createElement('img');
        image.id = 'carousel-image';
        image.src = slide.image;
        image.alt = `${slide.title}界面`;
        media.append(image);
      }
      kicker.textContent = slide.kicker;
      title.textContent = slide.title;
      description.textContent = slide.description;
      current.textContent = String(index + 1).padStart(2, '0');
      dots.querySelectorAll('button').forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      thumbs.querySelectorAll('button').forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      root.classList.remove('is-switching');
    }, 120);
  }

  document.querySelectorAll('[data-carousel-target]').forEach((button) => button.addEventListener('click', () => show(Number(button.dataset.carouselTarget) || 0)));
  $('.carousel-prev').addEventListener('click', () => show(index - 1));
  $('.carousel-next').addEventListener('click', () => show(index + 1));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
  });
  root.tabIndex = 0;
  show(index);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard unavailable');
}

function initCopyCommands() {
  document.querySelectorAll('[data-copy-command]').forEach((button) => {
    const originalLabel = button.textContent;
    button.addEventListener('click', async () => {
      try {
        await copyText(button.dataset.copyCommand || '');
        button.textContent = '已复制';
        button.classList.add('copied');
      } catch {
        button.textContent = '请手动复制';
      }
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove('copied');
      }, 1600);
    });
  });
}

initCarousel();
initCopyCommands();
