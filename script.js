const SUPABASE_URL = 'https://xdqgrflrxjocnjkwacdw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_njD2UUT3CcW-III-r859_w_VMhuSqk5';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// 상태 변수
let posts = [], selectedThumbIdx = 0, editingIdx = 0, deleteTargetId = null, editingPostId = null;
let pendingFiles = []; // { originalUrl, croppedUrl, file, isExisting: bool }
let croppedThumbBlob = null; 
let cropTargetIdx = null, cropMode = 'image', cropStart = null, cropEnd = null, isDragging = false;
let lbImages = [], lbIdx = 0;

// 줌 관련 변수
let scale = 1, panX = 0, panY = 0, isPanning = false, panStartX = 0, panStartY = 0, pinchDist = 0;

// DOM 참조
const gridEl = document.getElementById('grid');
const modal = document.getElementById('modal');
const fileInput = document.getElementById('fileInput');
const previewGrid = document.getElementById('previewGrid');
const backBtn = document.getElementById('backBtn');
const navTitle = document.getElementById('navTitle');
const cropModal = document.getElementById('cropModal');
const cropImg = document.getElementById('cropImg');
const cropSelection = document.getElementById('cropSelection');
const cropContainer = document.getElementById('cropContainer');
const cropCanvas = document.getElementById('cropCanvas');
const uploadingMsg = document.getElementById('uploadingMsg');
const confirmModal = document.getElementById('confirmModal');
const detailImages = document.getElementById('detailImages');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxThumbs = document.getElementById('lightboxThumbs');
const lightboxCounter = document.getElementById('lightboxCounter');

// --- [1. 초기 설정 및 이벤트 바인딩] ---

// 드래그 앤 드롭 순서 변경 (SortableJS)
new Sortable(previewGrid, {
  animation: 150,
  ghostClass: 'sortable-ghost',
  onEnd: function (evt) {
    const item = pendingFiles.splice(evt.oldIndex, 1)[0];
    pendingFiles.splice(evt.newIndex, 0, item);
    const fixIdx = (idx) => {
      if (idx === evt.oldIndex) return evt.newIndex;
      if (idx > evt.oldIndex && idx <= evt.newIndex) return idx - 1;
      if (idx < evt.oldIndex && idx >= evt.newIndex) return idx + 1;
      return idx;
    };
    selectedThumbIdx = fixIdx(selectedThumbIdx);
    editingIdx = fixIdx(editingIdx);
    refreshPreviewGrid();
  }
});

// 파일 업로드 관련 이벤트 (버그 수정 포인트)
document.getElementById('fileDrop').onclick = () => fileInput.click();

fileInput.onchange = () => handleFiles(fileInput.files);

const drop = document.getElementById('fileDrop');
drop.ondragover = e => e.preventDefault();
drop.ondrop = e => { e.preventDefault(); handleFiles(e.dataTransfer.files); };

// 하단 크롭 버튼들
document.getElementById('bottomImageCropBtn').onclick = () => openCrop(editingIdx, 'image');
document.getElementById('bottomThumbCropBtn').onclick = () => { selectedThumbIdx = editingIdx; openCrop(editingIdx, 'gridThumb'); };

// --- [2. 핵심 로직: 압축 및 파일 처리] ---

async function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
      else { if (height > maxWidth) { width *= maxWidth / height; height = maxWidth; } }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

async function handleFiles(files) {
  if (!files || files.length === 0) return;
  uploadingMsg.style.display = 'block'; uploadingMsg.textContent = '이미지 최적화 중...';
  let loaded = 0; const total = files.length; const wasEmpty = pendingFiles.length === 0;
  
  for (const f of Array.from(files)) {
    const reader = new FileReader();
    const dataUrl = await new Promise(res => { reader.onload = e => res(e.target.result); reader.readAsDataURL(f); });
    const compressedUrl = await compressImage(dataUrl, 1200, 0.8);
    pendingFiles.push({ originalUrl: compressedUrl, croppedUrl: null, file: f, isExisting: false });
    if (++loaded === total) {
      if (wasEmpty) { selectedThumbIdx = 0; editingIdx = 0; }
      fileInput.value = ''; // 다음 업로드를 위해 비워줌
      uploadingMsg.style.display = 'none'; refreshPreviewGrid();
    }
  }
}

function refreshPreviewGrid() {
  previewGrid.innerHTML = ''; pendingFiles.forEach((_, i) => renderPreviewItem(i));
  const hasFiles = pendingFiles.length > 0;
  document.getElementById('bottomImageCropBtn').style.opacity = hasFiles ? '1' : '0.5';
  document.getElementById('bottomThumbCropBtn').style.opacity = hasFiles ? '1' : '0.5';
}

function renderPreviewItem(i) {
  const wrap = document.createElement('div'); wrap.className = 'pg-item'; 
  if (i === editingIdx) wrap.classList.add('is-editing');
  wrap.id = `pg-${i}`;
  const img = document.createElement('img');
  img.src = pendingFiles[i].croppedUrl || pendingFiles[i].originalUrl;
  if (i === selectedThumbIdx) img.classList.add('is-thumb');
  wrap.onclick = () => { editingIdx = i; refreshPreviewGrid(); };
  const btns = document.createElement('div'); btns.className = 'pg-btns';
  const tBtn = document.createElement('button'); tBtn.className = 'pg-btn thumb-btn'; tBtn.textContent = '★ 대표';
  tBtn.onclick = e => { e.stopPropagation(); selectedThumbIdx = i; editingIdx = i; croppedThumbBlob = null; refreshPreviewGrid(); };
  const dBtn = document.createElement('button'); dBtn.className = 'pg-btn del-btn'; dBtn.textContent = '✖ 삭제';
  dBtn.onclick = e => { 
    e.stopPropagation(); pendingFiles.splice(i, 1);
    if (selectedThumbIdx >= pendingFiles.length) selectedThumbIdx = 0;
    if (editingIdx >= pendingFiles.length) editingIdx = 0;
    refreshPreviewGrid(); 
  };
  btns.appendChild(tBtn); btns.appendChild(dBtn);
  if (i === selectedThumbIdx) {
    const lbl = document.createElement('span'); lbl.className = 'thumb-label'; lbl.textContent = '대표'; wrap.appendChild(lbl);
  }
  wrap.appendChild(img); wrap.appendChild(btns); previewGrid.appendChild(wrap);
}

// --- [3. 게시물 저장 및 수정] ---

document.getElementById('savePost').onclick = async () => {
  if (!pendingFiles.length) return alert('사진을 선택해주세요.');
  uploadingMsg.style.display = 'block'; uploadingMsg.textContent = '저장 중...';
  document.getElementById('savePost').disabled = true;
  try {
    const postId = editingPostId || Date.now().toString();
    const imageUrls = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const pf = pendingFiles[i];
      if (pf.isExisting && !pf.croppedUrl) imageUrls.push(pf.originalUrl);
      else {
        let b = pf.croppedUrl ? await (await fetch(pf.croppedUrl)).blob() : await (await fetch(pf.originalUrl)).blob();
        const path = `${postId}/${Date.now()}_${i}.jpg`;
        await sb.storage.from('gallery').upload(path, b);
        imageUrls.push(sb.storage.from('gallery').getPublicUrl(path).data.publicUrl);
      }
    }
    let tUrl = imageUrls[selectedThumbIdx];
    if (croppedThumbBlob) {
      const tPath = `${postId}/thumb_${Date.now()}.jpg`;
      await sb.storage.from('gallery').upload(tPath, croppedThumbBlob);
      tUrl = sb.storage.from('gallery').getPublicUrl(tPath).data.publicUrl;
    }
    if (editingPostId) {
      const old = posts.find(p => p.id === editingPostId);
      const del = old.images.filter(u => !imageUrls.includes(u)).map(u => u.split('/gallery/')[1]);
      if (del.length) sb.storage.from('gallery').remove(del);
      await sb.from('posts').update({ thumb: tUrl, images: imageUrls }).eq('id', editingPostId);
    } else await sb.from('posts').insert({ id: postId, thumb: tUrl, images: imageUrls });
    modal.classList.remove('open'); await loadPosts();
  } catch(e) { alert(e.message); }
  finally { uploadingMsg.style.display = 'none'; document.getElementById('savePost').disabled = false; }
};

async function loadPosts() {
  const { data, error } = await sb.from('posts').select('*').order('created_at', { ascending: false });
  if (error) return; posts = data || []; renderGrid();
}

function renderGrid() {
  gridEl.innerHTML = '';
  posts.forEach(post => {
    const item = document.createElement('div'); item.className = 'grid-item';
    const img = document.createElement('img'); img.src = post.thumb; item.appendChild(img);
    const bWrap = document.createElement('div'); bWrap.className = 'grid-btns';
    const eBtn = document.createElement('button'); eBtn.textContent = '✏️ 수정'; eBtn.onclick = e => { e.stopPropagation(); openEditPost(post); };
    const dBtn = document.createElement('button'); dBtn.textContent = '🗑️ 삭제'; dBtn.onclick = e => { e.stopPropagation(); deleteTargetId = post.id; confirmModal.classList.add('open'); };
    bWrap.appendChild(eBtn); bWrap.appendChild(dBtn); item.appendChild(bWrap);
    item.onclick = () => openDetail(post); gridEl.appendChild(item);
  });
}

async function openEditPost(post) {
  editingPostId = post.id;
  resetModal(); document.getElementById('modalTitle').textContent = '게시글 수정';
  pendingFiles = post.images.map(u => ({ originalUrl: u, croppedUrl: null, file: null, isExisting: true }));
  selectedThumbIdx = post.images.indexOf(post.thumb); if (selectedThumbIdx === -1) selectedThumbIdx = 0;
  refreshPreviewGrid(); modal.classList.add('open');
}

// --- [4. 상세 보기 및 라이트박스 (줌 복구)] ---

function openDetail(post) {
  detailImages.innerHTML = '';
  post.images.forEach((src, i) => {
    const img = document.createElement('img'); img.src = src;
    img.onclick = () => openLightbox(post.images, i);
    detailImages.appendChild(img);
  });
  document.getElementById('gridPage').classList.remove('active');
  document.getElementById('detailPage').classList.add('active');
  backBtn.style.display = 'block'; navTitle.textContent = ''; window.scrollTo(0, 0);
}

backBtn.onclick = () => {
  document.getElementById('detailPage').classList.remove('active');
  document.getElementById('gridPage').classList.add('active');
  backBtn.style.display = 'none'; navTitle.textContent = 'GALLERY';
};

function openLightbox(images, idx) {
  lbImages = images; lbIdx = idx;
  lightboxThumbs.innerHTML = '';
  images.forEach((src, i) => {
    const th = document.createElement('img'); th.src = src;
    th.onclick = () => goLightbox(i); lightboxThumbs.appendChild(th);
  });
  updateLightbox(); lightbox.classList.add('open');
}

function updateLightbox() {
  lightboxImg.src = lbImages[lbIdx];
  lightboxCounter.textContent = `${lbIdx + 1} / ${lbImages.length}`;
  const ths = lightboxThumbs.querySelectorAll('img');
  ths.forEach((el, i) => el.classList.toggle('active', i === lbIdx));
  resetZoom();
}

function goLightbox(idx) { lbIdx = (idx + lbImages.length) % lbImages.length; updateLightbox(); }
function resetZoom() { scale = 1; panX = 0; panY = 0; applyTransform(); }
function applyTransform() { lightboxImg.style.transform = `scale(${scale}) translate(${panX}px, ${panY}px)`; }

// 라이트박스 마우스/터치 이벤트
lightboxImg.addEventListener('wheel', e => {
  e.preventDefault();
  scale = Math.min(5, Math.max(1, scale - e.deltaY * 0.002));
  if (scale === 1) { panX = 0; panY = 0; } applyTransform();
}, { passive: false });

lightboxImg.addEventListener('mousedown', e => {
  if (scale === 1) return;
  isPanning = true; panStartX = e.clientX - panX * scale; panStartY = e.clientY - panY * scale;
  lightboxImg.classList.add('grabbing');
});

window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  panX = (e.clientX - panStartX) / scale; panY = (e.clientY - panStartY) / scale; applyTransform();
});

window.addEventListener('mouseup', () => { isPanning = false; lightboxImg.classList.remove('grabbing'); });

lightboxImg.addEventListener('touchstart', e => {
  if (e.touches.length === 2) pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  else if (e.touches.length === 1 && scale > 1) { isPanning = true; panStartX = e.touches[0].clientX - panX * scale; panStartY = e.touches[0].clientY - panY * scale; }
}, { passive: true });

lightboxImg.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    scale = Math.min(5, Math.max(1, scale * (d / pinchDist))); pinchDist = d;
    if (scale === 1) { panX = 0; panY = 0; } applyTransform();
  } else if (isPanning) {
    panX = (e.touches[0].clientX - panStartX) / scale; panY = (e.touches[0].clientY - panStartY) / scale; applyTransform();
  }
}, { passive: false });

lightboxImg.addEventListener('touchend', () => isPanning = false);

// --- [5. 기타 유틸리티 (크롭, 삭제 등)] ---

function openCrop(i, mode) {
  if (i === null || !pendingFiles[i]) return;
  cropTargetIdx = i; cropMode = mode;
  cropImg.src = pendingFiles[i].croppedUrl || pendingFiles[i].originalUrl;
  cropSelection.style.display = 'none'; cropStart = null; cropEnd = null;
  cropModal.classList.add('open');
}

document.getElementById('cropApplyBtn').onclick = () => {
  if (!cropStart || !cropEnd || cropTargetIdx === null) return;
  const x = Math.min(cropStart.x, cropEnd.x), y = Math.min(cropStart.y, cropEnd.y), w = Math.abs(cropEnd.x - cropStart.x), h = Math.abs(cropEnd.y - cropStart.y);
  const sx = cropImg.naturalWidth / cropImg.offsetWidth, sy = cropImg.naturalHeight / cropImg.offsetHeight;
  cropCanvas.width = w * sx; cropCanvas.height = h * sy;
  const src = new Image();
  src.onload = () => {
    cropCanvas.getContext('2d').drawImage(src, x*sx, y*sy, w*sx, h*sy, 0, 0, cropCanvas.width, cropCanvas.height);
    const res = cropCanvas.toDataURL('image/jpeg', 0.85);
    if (cropMode === 'image') { pendingFiles[cropTargetIdx].croppedUrl = res; pendingFiles[cropTargetIdx].isExisting = false; refreshPreviewGrid(); }
    else { fetch(res).then(r => r.blob()).then(b => { croppedThumbBlob = b; alert('썸네일 크롭 완료!'); }); }
    cropModal.classList.remove('open');
  };
  src.src = cropImg.src;
}

cropContainer.addEventListener('mousedown', e => {
  const r = cropImg.getBoundingClientRect();
  cropStart = { x: e.clientX - r.left, y: e.clientY - r.top }; cropEnd = { ...cropStart }; isDragging = true; updateCropSel(); e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!isDragging || !cropModal.classList.contains('open')) return;
  const r = cropImg.getBoundingClientRect();
  cropEnd = { x: Math.max(0, Math.min(e.clientX - r.left, cropImg.offsetWidth)), y: Math.max(0, Math.min(e.clientY - r.top, cropImg.offsetHeight)) };
  updateCropSel();
});
window.addEventListener('mouseup', () => isDragging = false);

function updateCropSel() {
  if (!cropStart || !cropEnd) return;
  const x = Math.min(cropStart.x, cropEnd.x), y = Math.min(cropStart.y, cropEnd.y), w = Math.abs(cropEnd.x - cropStart.x), h = Math.abs(cropEnd.y - cropStart.y);
  cropSelection.style.display = w > 2 && h > 2 ? 'block' : 'none';
  Object.assign(cropSelection.style, { left: x+'px', top: y+'px', width: w+'px', height: h+'px' });
}

document.getElementById('confirmDeleteBtn').onclick = async () => {
  confirmModal.classList.remove('open'); if (!deleteTargetId) return;
  const p = posts.find(x => String(x.id) === String(deleteTargetId));
  const { data: fs } = await sb.storage.from('gallery').list(p.id);
  if (fs && fs.length) await sb.storage.from('gallery').remove(fs.map(f => `${p.id}/${f.name}`));
  await sb.from('posts').delete().eq('id', deleteTargetId);
  deleteTargetId = null; await loadPosts();
};

function resetModal() { pendingFiles = []; selectedThumbIdx = 0; editingIdx = 0; croppedThumbBlob = null; previewGrid.innerHTML = ''; }
document.getElementById('closeModal').onclick = () => modal.classList.remove('open');
document.getElementById('lightboxClose').onclick = () => lightbox.classList.remove('open');
document.getElementById('lightboxPrev').onclick = () => goLightbox(lbIdx - 1);
document.getElementById('lightboxNext').onclick = () => goLightbox(lbIdx + 1);
lightbox.addEventListener('click', e => { if (e.target === lightbox) lightbox.classList.remove('open'); });
document.getElementById('confirmCancelBtn').onclick = () => confirmModal.classList.remove('open');
document.getElementById('cropCancelBtn').onclick = () => cropModal.classList.remove('open');

// 초기 데이터 로드
loadPosts();
