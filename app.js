// app.js
let video = document.getElementById('video');
let overlay = document.getElementById('overlay');
let overlayCtx = overlay.getContext('2d');
let captureBtn = document.getElementById('captureBtn');
let autoScanBtn = document.getElementById('autoScanBtn');
let stopAutoBtn = document.getElementById('stopAutoBtn');
let capturePreview = document.getElementById('capturePreview');
let saveRowBtn = document.getElementById('saveRow');
let exportExcelBtn = document.getElementById('exportExcel');
let downloadSampleBtn = document.getElementById('downloadSample');

let fullNameInput = document.getElementById('fullName');
let dniInput = document.getElementById('dniNumber');
let sexInput = document.getElementById('sex');
let ageRangeInput = document.getElementById('ageRange');
let dobInput = document.getElementById('dob');
let communityInput = document.getElementById('community');
let phoneInput = document.getElementById('phone');
let dataTableBody = document.querySelector('#dataTable tbody');

let autoScanning = false;
let stream = null;
let scanningInterval = null;
let cvReady = false;

// Wait for OpenCV to be ready
function onOpenCvReady() {
  console.log('OpenCV ready');
  cvReady = true;
}
if (typeof cv !== 'undefined') onOpenCvReady();
window.cv = window.cv || null;
if (!window.cv) {
  window['onOpenCvReady'] = onOpenCvReady;
}

// Setup camera
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Tu navegador no soporta acceso a la cámara.");
    console.error("navigator.mediaDevices.getUserMedia no disponible");
    return;
  }

  try {
    const constraints = {
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: "continuous"
      }
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    resizeOverlay();
    window.addEventListener('resize', resizeOverlay);

  } catch (err) {
    alert('Error accediendo a la cámara: ' + err.message);
    console.error(err);
  }
}

function resizeOverlay() {
  overlay.width = video.videoWidth || video.clientWidth;
  overlay.height = video.videoHeight || video.clientHeight;
}

// Draw guide rectangle
function drawGuide() {
  overlayCtx.clearRect(0,0,overlay.width,overlay.height);
  const w = overlay.width*0.85;
  const h = overlay.height*0.55;
  const x = (overlay.width - w) / 2;
  const y = (overlay.height - h) / 2;
  overlayCtx.strokeStyle = 'rgba(79,70,229,0.7)';
  overlayCtx.lineWidth = 3;
  overlayCtx.setLineDash([10,6]);
  overlayCtx.strokeRect(x,y,w,h);
}
video.addEventListener('loadeddata', drawGuide);

// Capture frame from video to canvas
function captureFrame() {
  const tmp = document.createElement('canvas');
  tmp.width = video.videoWidth;
  tmp.height = video.videoHeight;
  const ctx = tmp.getContext('2d');
  ctx.drawImage(video,0,0,tmp.width,tmp.height);
  return tmp;
}

// Use OpenCV to detect largest 4-point contour (card) and warp perspective
function detectAndWarpCard(inputCanvas) {
  return new Promise((resolve, reject) => {
    if (!cvReady) {
      resolve(inputCanvas.toDataURL('image/jpeg', 0.9));
      return;
    }
    try {
      let src = cv.imread(inputCanvas);
      let dst = new cv.Mat();
      cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(src, src, new cv.Size(5,5), 0);
      cv.Canny(src, dst, 75, 200);

      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(dst, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;
      let approxPoly = null;
      for (let i=0;i<contours.size();i++){
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if(area < 1000) { cnt.delete(); continue; }
        let peri = cv.arcLength(cnt, true);
        let approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
        if (approx.rows === 4 && area > maxArea) {
          maxArea = area;
          approxPoly = approx.clone();
        }
        cnt.delete();
        approx.delete();
      }
      if (!approxPoly) {
        src.delete(); dst.delete(); contours.delete(); hierarchy.delete();
        resolve(inputCanvas.toDataURL('image/jpeg', 0.9));
        return;
      }

      let pts = [];
      for (let i=0;i<4;i++){
        pts.push({x: approxPoly.intAt(i,0), y: approxPoly.intAt(i,1)});
      }
      pts = sortCorners(pts);

      let widthA = Math.hypot(pts[2].x-pts[3].x, pts[2].y-pts[3].y);
      let widthB = Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y);
      let maxW = Math.max(Math.floor(widthA), Math.floor(widthB));
      let heightA = Math.hypot(pts[1].x-pts[2].x, pts[1].y-pts[2].y);
      let heightB = Math.hypot(pts[0].x-pts[3].x, pts[0].y-pts[3].y);
      let maxH = Math.max(Math.floor(heightA), Math.floor(heightB));

      let srcTri = cv.matFromArray(4,1,cv.CV_32FC2, [pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y]);
      let dstTri = cv.matFromArray(4,1,cv.CV_32FC2, [0,0, maxW-1,0, maxW-1,maxH-1, 0,maxH-1]);
      let M = cv.getPerspectiveTransform(srcTri, dstTri);
      let warped = new cv.Mat();
      let dsize = new cv.Size(maxW, maxH);
      cv.warpPerspective(cv.imread(inputCanvas), warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

      cv.cvtColor(warped, warped, cv.COLOR_RGBA2GRAY, 0);
      let scale = Math.max(1, Math.floor(1200 / Math.max(warped.cols, warped.rows)));
      if (scale > 1) cv.resize(warped, warped, new cv.Size(warped.cols*scale, warped.rows*scale), 0, 0, cv.INTER_CUBIC);
      cv.adaptiveThreshold(warped, warped, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10);

      let outCanvas = document.createElement('canvas');
      outCanvas.width = warped.cols;
      outCanvas.height = warped.rows;
      cv.imshow(outCanvas, warped);

      src.delete(); dst.delete(); contours.delete(); hierarchy.delete();
      approxPoly.delete(); srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();

      resolve(outCanvas.toDataURL('image/jpeg', 0.95));
    } catch (err) {
      console.error('detectAndWarpCard error', err);
      resolve(inputCanvas.toDataURL('image/jpeg', 0.9));
    }
  });
}

// helper to order corners
function sortCorners(pts) {
  pts.sort((a,b)=>a.x - b.x);
  let left = pts.slice(0,2);
  let right = pts.slice(2,4);
  left.sort((a,b)=>a.y-b.y);
  right.sort((a,b)=>a.y-b.y);
  return [left[0], right[0], right[1], left[1]];
}

// OCR with Tesseract.js
async function runOCRDataURL(dataURL) {
  const worker = Tesseract.createWorker({ logger: m => console.log(m) });
  await worker.load();
  await worker.loadLanguage('spa+eng');
  await worker.initialize('spa+eng');
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚáéíóúÑñ0123456789-/. ',
    preserve_interword_spaces: '1'
  });
  const { data: { text } } = await worker.recognize(dataURL);
  await worker.terminate();
  return text;
}

// Parse text to extract fields
function parseOCRText(text) {
  const lines = text.split('\n').map(s=>s.trim()).filter(Boolean);
  let joined = lines.join(' | ');
  let result = { fullName:'', dni:'', sex:'', dob:'' };

  const dniRegex = /\b(\d{6,12})\b/g;
  let dniMatch = null;
  while((m = dniRegex.exec(joined)) !== null){ dniMatch = m[1]; }
  if (dniMatch) result.dni = dniMatch;

  const dateRegex = /(\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b)|(\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b)/;
  let datem = joined.match(dateRegex);
  if (datem) {
    let raw = datem[0].replace(/[^0-9\/\-]/g,'');
    let parts = raw.includes('/') ? raw.split('/') : raw.split('-');
    if (parts[0].length===4) { let y=parts[0].padStart(4,'0'), m2=parts[1].padStart(2,'0'), d=parts[2].padStart(2,'0'); result.dob = `${y}-${m2}-${d}`; }
    else { let d=parts[0].padStart(2,'0'), m2=parts[1].padStart(2,'0'), y=parts[2]; if(y.length===2) y='19'+y; result.dob = `${y}-${m2}-${d}`; }
  }

  let sex = '';
  if (/mujer|femenino|f/i.test(joined)) sex = 'Mujer';
  else if (/hombre|masculino|m/i.test(joined)) sex = 'Hombre';
  result.sex = sex;

  let candidate = '';
  for (let l of lines) {
    let digits = (l.match(/\d/g) || []).length;
    let letters = (l.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
    if (letters > digits && letters > 6 && /[A-ZÁÉÍÓÚÑ]/.test(l)) { candidate = l; break; }
  }
  if (!candidate && lines.length) candidate = lines[0];
  result.fullName = candidate.replace(/\|/g,' ').trim();

  return result;
}

// populate form
function populateForm(parsed, dataURL) {
  capturePreview.src = dataURL;
  if (parsed.fullName) fullNameInput.value = parsed.fullName;
  if (parsed.dni) dniInput.value = parsed.dni;
  if (parsed.sex) sexInput.value = parsed.sex;
  if (parsed.dob) dobInput.value = parsed.dob;
  if (dobInput.value) {
    const age = calcAge(dobInput.value);
    ageRangeInput.value = ageRangeFromAge(age);
  } else {
    ageRangeInput.value = '';
  }
}

// calculate age
function calcAge(isoDate) {
  if (!isoDate) return null;
  const dob = new Date(isoDate);
  const diff = Date.now() - dob.getTime();
  const ageDt = new Date(diff);
  return Math.abs(ageDt.getUTCFullYear() - 1970);
}
function ageRangeFromAge(age) {
  if (age === null) return '';
  const lower = Math.floor(age/10)*10;
  return `${lower}-${lower+9}`;
}

// main scan flow
async function scanOnce() {
  drawGuide();
  const frame = captureFrame();
  const warpedDataUrl = await detectAndWarpCard(frame);
  capturePreview.src = warpedDataUrl;
  const text = await runOCRDataURL(warpedDataUrl);
  console.log('OCR text:', text);
  const parsed = parseOCRText(text);
  populateForm(parsed, warpedDataUrl);
}

// auto scan
async function startAutoScan() {
  if (autoScanning) return;
  autoScanning = true;
  autoScanBtn.style.display = 'none';
  stopAutoBtn.style.display = 'inline-block';
  scanningInterval = setInterval(async () => { await scanOnce(); }, 3500);
}
function stopAutoScan() {
  autoScanning = false;
  clearInterval(scanningInterval);
  autoScanBtn.style.display = 'inline-block';
  stopAutoBtn.style.display = 'none';
}

// save row
function addRowToTable() {
  const row = document.createElement('tr');
  const fields = [
    fullNameInput.value || '',
    dniInput.value || '',
    sexInput.value || '',
    ageRangeInput.value || '',
    dobInput.value || '',
    communityInput.value || '',
    phoneInput.value || ''
  ];
  fields.forEach(f=>{ const td = document.createElement('td'); td.textContent = f; row.appendChild(td); });
  dataTableBody.appendChild(row);
  clearFormFields();
}

// clear form
function clearFormFields(){
  fullNameInput.value=''; dniInput.value=''; sexInput.value=''; ageRangeInput.value=''; dobInput.value=''; communityInput.value=''; phoneInput.value='';
  capturePreview.src='';
}

// export to Excel
function exportTableToExcel(filename='dni_export.xlsx') {
  const wb = XLSX.utils.book_new();
  const rows = [];
  rows.push(['Nombre completo','Número de DNI','Sexo','Rango de edad','Fecha Nacimiento','Comunidad','Celular']);
  const trs = dataTableBody.querySelectorAll('tr');
  trs.forEach(tr=>{ const cols = Array.from(tr.querySelectorAll('td')).map(td=>td.textContent); rows.push(cols); });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  XLSX.writeFile(wb, filename);
}

// event listeners
captureBtn.addEventListener('click', () => { captureBtn.disabled = true; scanOnce().finally(()=>captureBtn.disabled=false); });
autoScanBtn.addEventListener('click', startAutoScan);
stopAutoBtn.addEventListener('click', stopAutoScan);
saveRowBtn.addEventListener('click', addRowToTable);
exportExcelBtn.addEventListener('click', ()=>exportTableToExcel());
downloadSampleBtn.addEventListener('click', ()=>exportTableToExcel('dni_sample.xlsx'));

document.getElementById('clearTable').addEventListener('click', ()=>{ dataTableBody.innerHTML=''; });
document.getElementById('clearForm').addEventListener('click', clearFormFields);

dobInput.addEventListener('change', ()=> {
  if (dobInput.value) {
    const age = calcAge(dobInput.value);
    ageRangeInput.value = ageRangeFromAge(age);
  }
});

// init camera
startCamera();
