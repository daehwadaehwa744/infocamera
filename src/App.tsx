import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldCheck, Camera, FolderLock, SwitchCamera, Loader2, CameraOff,
  ZoomOut, ZoomIn, UserSquare2, FolderOutput, FolderKey, FolderSearch,
  Aperture, Images, Folder as FolderIcon, Grid, List, RefreshCw, Trash2,
  Edit3, Sliders, X, Scissors, CheckCircle2, AlertCircle, FolderCheck, RotateCcw
} from 'lucide-react';

const DB_NAME = 'PhotoAppDB';
const STORE_NAME = 'handles';

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setDBItem(key: string, val: any) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(val, key);
  return new Promise((resolve) => { tx.oncomplete = () => resolve(true); });
}

async function getDBItem(key: string): Promise<any> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getUniqueFilename(baseName: string, currentItems: any[], dirHandle: any): Promise<string> {
  const checkExists = async (name: string) => {
    if (currentItems.some(item => item.name === name)) return true;
    if (dirHandle) {
      try {
        await dirHandle.getFileHandle(name, { create: false });
        // File exists physically
        return true;
      } catch (e: any) {
        if (e.name === 'NotFoundError') return false;
      }
    }
    return false;
  };

  let counter = 0;
  let filename = `${baseName}.jpg`;
  while (await checkExists(filename)) {
    counter++;
    filename = `${baseName}_${counter}.jpg`;
  }
  return filename;
}

async function verifyPermission(fileHandle: any, withUserGesture = false) {
  const opts = { mode: 'readwrite' };
  try {
    if ((await fileHandle.queryPermission(opts)) === 'granted') return true;
    if (withUserGesture && (await fileHandle.requestPermission(opts)) === 'granted') return true;
  } catch (e) {
    console.warn("권한 확인 중 오류:", e);
  }
  return false;
}

export default function App() {
  const [showPermissionModal, setShowPermissionModal] = useState(true);
  const [cameraPermOk, setCameraPermOk] = useState<boolean | 'skipped' | 'failed'>(false);
  const [folderPermOk, setFolderPermOk] = useState(false);
  const [savedDirectoryHandle, setSavedDirectoryHandle] = useState<any>(null);
  const [directoryHandle, setDirectoryHandle] = useState<any>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(() => (localStorage.getItem('cameraFacingMode') as 'user' | 'environment') || 'user');
  const [zoom, setZoom] = useState(1);
  const [cameraBrightness, setCameraBrightness] = useState(0);
  const [cameraContrast, setCameraContrast] = useState(0);
  const [isCameraLoading, setIsCameraLoading] = useState(true);
  const [showNoCameraFallback, setShowNoCameraFallback] = useState(false);

  const [memberName, setMemberName] = useState('');
  const [memberId, setMemberId] = useState('');

  const [viewMode, setViewMode] = useState(() => localStorage.getItem('galleryViewMode') || 'grid');
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('gallerySortMode') || 'date-desc');
  const [galleryItems, setGalleryItems] = useState<any[]>([]);
  const [sessionFiles, setSessionFiles] = useState<any[]>([]);
  const [directoryUrls, setDirectoryUrls] = useState<string[]>([]);

  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);

  const [showEditor, setShowEditor] = useState(false);
  const [editImageSrc, setEditImageSrc] = useState('');
  const [editFilename, setEditFilename] = useState('');
  const [editBrightness, setEditBrightness] = useState(0);
  const [editContrast, setEditContrast] = useState(0);
  const [flash, setFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const guideHandleRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const editWorkAreaRef = useRef<HTMLDivElement>(null);
  const editGuideRef = useRef<HTMLDivElement>(null);
  const editGuideHandleRef = useRef<HTMLDivElement>(null);
  const editImageRef = useRef<HTMLImageElement>(null);

  const currentStreamRef = useRef<MediaStream | null>(null);
  const toastIdCounter = useRef(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = toastIdCounter.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const updateGallery = useCallback(async () => {
    let newItems: any[] = [];
    
    sessionFiles.forEach(item => {
        newItems.push({ name: item.name, url: item.url, lastModified: item.lastModified, isSession: true });
    });

    const newDirUrls: string[] = [];

    if (directoryHandle) {
        try {
            for await (const entry of directoryHandle.values()) {
                if (entry.kind === 'file' && entry.name.match(/\.(jpg|jpeg|png)$/i)) {
                    const file = await entry.getFile();
                    if (!newItems.find(item => item.name === entry.name)) {
                        const url = URL.createObjectURL(file);
                        newDirUrls.push(url);
                        newItems.push({ name: entry.name, url: url, lastModified: file.lastModified, isSession: false });
                    }
                }
            }
        } catch(e) {
            console.warn("갤러리 폴더 읽기 오류", e);
        }
    }

    newItems.sort((a, b) => {
        switch(sortMode) {
            case 'date-asc': return a.lastModified - b.lastModified;
            case 'name-asc': return a.name.localeCompare(b.name);
            case 'name-desc': return b.name.localeCompare(a.name);
            case 'date-desc': default: return b.lastModified - a.lastModified;
        }
    });

    setDirectoryUrls((prev) => {
        prev.forEach(url => URL.revokeObjectURL(url));
        return newDirUrls;
    });

    setGalleryItems(newItems);
  }, [sessionFiles, directoryHandle, sortMode]);

  useEffect(() => {
      updateGallery();
  }, [updateGallery]);

  const startCamera = useCallback(async (isUserGesture = false) => {
    setIsCameraLoading(true);
    setShowNoCameraFallback(false);

    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach((t) => t.stop());
    }

    try {
      currentStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 2592 }, height: { ideal: 1944 } },
        audio: false,
      });
      setCameraPermOk(true);
    } catch (e1) {
      console.warn("고해상도 카메라 요청 실패:", e1);
      try {
        currentStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        setCameraPermOk(true);
      } catch (e2: any) {
        console.warn("카메라 권한 획득 실패:", e2.message);
        setCameraPermOk('failed');
        setIsCameraLoading(false);

        if (!isUserGesture) {
          setShowNoCameraFallback(true);
        }
        return;
      }
    }

    if (currentStreamRef.current && videoRef.current) {
      videoRef.current.srcObject = currentStreamRef.current;
      videoRef.current.onloadedmetadata = () => {
        setIsCameraLoading(false);
        setShowNoCameraFallback(false);
      };
    }
  }, [facingMode]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const handle = await getDBItem('dirHandle');
        if (!mounted) return;
        if (handle) {
          setSavedDirectoryHandle(handle);
        } else {
          setFolderPermOk(true);
        }
      } catch (e) {
        console.warn("폴더 기록 확인 불가", e);
        if (mounted) setFolderPermOk(true);
      }

      startCamera(false);
    })();
    return () => { mounted = false; };
  }, [startCamera]);

  useEffect(() => {
    const initGuide = (gRef: React.RefObject<HTMLDivElement>, hRef: React.RefObject<HTMLDivElement>, cRef: React.RefObject<HTMLDivElement>) => {
      const element = gRef.current;
      const handle = hRef.current;
      const container = cRef.current;
      if (!element || !handle || !container) return;
      if ((element as any)._hasEvents) return; // Prevent multiple bindings

      let isDragging = false;
      let isResizing = false;
      let startX = 0, startY = 0, startLeft = 0, startTop = 0, startWidth = 0;
      const aspect = 3 / 4;

      const downDrag = (e: any) => {
        if (e.target === handle || handle.contains(e.target)) return;
        isDragging = true;
        startX = e.clientX || (e.touches && e.touches[0].clientX);
        startY = e.clientY || (e.touches && e.touches[0].clientY);

        if (element.style.transform && element.style.transform.includes('translate')) {
          element.style.transform = 'none';
        }
        startLeft = parseFloat(element.style.left) || 0;
        startTop = parseFloat(element.style.top) || 0;
        element.style.cursor = 'grabbing';
        e.preventDefault();
      };

      const downResize = (e: any) => {
        isResizing = true;
        startX = e.clientX || (e.touches && e.touches[0].clientX);
        startY = e.clientY || (e.touches && e.touches[0].clientY);
        startWidth = element.offsetWidth;
        e.stopPropagation();
        e.preventDefault();
      };

      const move = (e: any) => {
        if (isDragging) {
          const clientX = e.clientX || (e.touches && e.touches[0].clientX);
          const clientY = e.clientY || (e.touches && e.touches[0].clientY);

          const newLeft = startLeft + (clientX - startX);
          const newTop = startTop + (clientY - startY);

          const cRect = container.getBoundingClientRect();
          const maxLeft = cRect.width - element.offsetWidth;
          const maxTop = cRect.height - element.offsetHeight;

          element.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
          element.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
        } else if (isResizing) {
          const clientX = e.clientX || (e.touches && e.touches[0].clientX);
          const dx = clientX - startX;

          let newWidth = startWidth + dx;
          let newHeight = newWidth / aspect;

          const cRect = container.getBoundingClientRect();
          const elLeft = parseFloat(element.style.left) || 0;
          const elTop = parseFloat(element.style.top) || 0;

          if (elLeft + newWidth > cRect.width) {
            newWidth = cRect.width - elLeft;
            newHeight = newWidth / aspect;
          }
          if (elTop + newHeight > cRect.height) {
            newHeight = cRect.height - elTop;
            newWidth = newHeight * aspect;
          }

          if (newWidth >= 60) {
            element.style.width = `${newWidth}px`;
            element.style.height = `${newHeight}px`;
          }
        }
      };

      const up = () => {
        if (isDragging) {
          isDragging = false;
          element.style.cursor = 'move';
        }
        if (isResizing) {
          isResizing = false;
        }
      };

      element.addEventListener('mousedown', downDrag);
      element.addEventListener('touchstart', downDrag, { passive: false });
      handle.addEventListener('mousedown', downResize);
      handle.addEventListener('touchstart', downResize, { passive: false });
      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('mouseup', up);
      document.addEventListener('touchend', up);

      (element as any)._hasEvents = true;

      return () => {
        element.removeEventListener('mousedown', downDrag);
        element.removeEventListener('touchstart', downDrag);
        handle.removeEventListener('mousedown', downResize);
        handle.removeEventListener('touchstart', downResize);
        document.removeEventListener('mousemove', move);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchend', up);
        (element as any)._hasEvents = false;
      };
    };

    const cleanup1 = initGuide(guideRef, guideHandleRef, containerRef);
    let cleanup2: ReturnType<typeof initGuide> | undefined;
    if (showEditor) {
      setTimeout(() => {
        cleanup2 = initGuide(editGuideRef, editGuideHandleRef, editWorkAreaRef);
      }, 100);
    }

    return () => {
      if (cleanup1) cleanup1();
      if (cleanup2) cleanup2();
    };
  }, [showEditor]);

  const handleMemberIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length > 9) value = value.substring(0, 9);
    if (value.length > 4) value = value.substring(0, 4) + '-' + value.substring(4);
    setMemberId(value);
  };

  const currentFilenamePreview = `${memberName.trim() || '미상'}_${memberId.trim() || '0000-00000'}.jpg`;

  const captureImage = () => {
    const name = memberName.trim() || '미상';
    const id = memberId.trim() || '0000-00000';
    const baseFilename = `${name}_${id}`;

    setFlash(true);
    setTimeout(() => setFlash(false), 200);

    const video = videoRef.current;
    const container = containerRef.current;
    const guide = guideRef.current;
    const canvas = canvasRef.current;
    if (!video || !container || !guide || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const containerRect = container.getBoundingClientRect();
    const vw = video.videoWidth; const vh = video.videoHeight;
    const cw = containerRect.width; const ch = containerRect.height;
    const fillScale = Math.max(cw / vw, ch / vh);

    const vx = (cw - vw * fillScale * zoom) / 2;
    const vy = (ch - vh * fillScale * zoom) / 2;

    const elLeft = parseFloat(guide.style.left || '0') || 0;
    const elTop = parseFloat(guide.style.top || '0') || 0;
    const gw = guide.offsetWidth;
    const gh = guide.offsetHeight;

    let sx = (elLeft - vx) / (fillScale * zoom);
    let sy = (elTop - vy) / (fillScale * zoom);
    let sw = gw / (fillScale * zoom);
    let sh = gh / (fillScale * zoom);

    if (facingMode === 'user') sx = vw - (sx + sw);

    canvas.width = sw; canvas.height = sh;
    ctx.filter = `brightness(${100 + cameraBrightness}%) contrast(${100 + cameraContrast}%)`;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.toBlob(async (blob) => {
      if (!blob) return showToast('이미지 처리 오류', 'error');

      const filename = await getUniqueFilename(baseFilename, galleryItems, directoryHandle);

      if (directoryHandle) {
        try {
          const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast(`'${filename}' 저장 완료`);
          updateGallery();
          return;
        } catch (e) {
          console.warn('폴더 저장 에러:', e);
        }
      }

      const url = URL.createObjectURL(blob);
      setSessionFiles((prev) => [...prev, { name: filename, file: new File([blob], filename), url, lastModified: Date.now() }]);

      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);

      showToast(`'${filename}' 임시 다운로드됨`);
      updateGallery();
    }, 'image/jpeg', 0.95);
  };

  const saveEdit = () => {
    const namePart = editFilename.substring(0, editFilename.lastIndexOf('.')) || editFilename;
    const baseFilename = `${namePart}_제단`;

    const editImage = editImageRef.current;
    const workArea = editWorkAreaRef.current;
    const guide = editGuideRef.current;

    if (!editImage || !workArea || !guide) return;

    const scaleX = editImage.naturalWidth / workArea.clientWidth;
    const scaleY = editImage.naturalHeight / workArea.clientHeight;

    const sx = parseFloat(guide.style.left || '0') * scaleX;
    const sy = parseFloat(guide.style.top || '0') * scaleY;
    const sw = guide.offsetWidth * scaleX;
    const sh = guide.offsetHeight * scaleY;

    const tempCvs = document.createElement('canvas');
    tempCvs.width = sw; tempCvs.height = sh;
    const tCtx = tempCvs.getContext('2d');
    if (!tCtx) return;

    tCtx.filter = `brightness(${100 + editBrightness}%) contrast(${100 + editContrast}%)`;
    tCtx.drawImage(editImage, sx, sy, sw, sh, 0, 0, sw, sh);

    tempCvs.toBlob(async (blob) => {
        if (!blob) return;
        
        const newFilename = await getUniqueFilename(baseFilename, galleryItems, directoryHandle);

        if (directoryHandle) {
            try {
                const fileH = await directoryHandle.getFileHandle(newFilename, { create: true });
                const w = await fileH.createWritable();
                await w.write(blob);
                await w.close();
                showToast('제단본 폴더 저장 완료');
                updateGallery();
                setShowEditor(false);
                return;
            } catch(e) {}
        }

        const url = URL.createObjectURL(blob);
        setSessionFiles((prev) => [...prev, { name: newFilename, file: new File([blob], newFilename), url, lastModified: Date.now() }]);
        const a = document.createElement('a'); a.href = url; a.download = newFilename;
        document.body.appendChild(a); a.click(); a.remove();

        showToast('제단본 임시 다운로드 완료');
        updateGallery();
        setShowEditor(false);
    }, 'image/jpeg', 0.95);
  };

  const deleteFile = async (e: React.MouseEvent, filename: string, isSession: boolean) => {
    e.stopPropagation();
    if (!window.confirm(`'${filename}' 사진을 정말 삭제하시겠습니까?`)) return;

    if (isSession) {
      setSessionFiles((prev) => prev.filter(f => f.name !== filename));
      showToast('임시 사진이 삭제되었습니다.');
      updateGallery();
    } else if (directoryHandle) {
      try {
        await directoryHandle.removeEntry(filename);
        showToast('파일이 삭제되었습니다.');
        updateGallery();
      } catch (err) {
        showToast('파일 삭제 실패. 권한을 확인해주세요.', 'error');
      }
    }
  };

  const handleOpenEditor = (url: string, filename: string) => {
    setEditFilename(filename);
    setEditBrightness(0);
    setEditContrast(0);
    setEditImageSrc(url);
    setShowEditor(true);
    
    setTimeout(() => {
        const area = editWorkAreaRef.current;
        const guide = editGuideRef.current;
        if (area && guide) {
            const waW = area.clientWidth; const waH = area.clientHeight;
            const initH = waH * 0.8; const initW = initH * 0.75;
            guide.style.width = initW + 'px'; guide.style.height = initH + 'px';
            guide.style.left = (waW - initW) / 2 + 'px';
            guide.style.top = (waH - initH) / 2 + 'px';
        }
    }, 50);
  };

  const handleRequestCamera = async () => {
    if (cameraPermOk === 'failed') {
      setCameraPermOk('skipped');
    } else {
      await startCamera(true);
    }
  };

  const handleRequestFolder = async () => {
    if (savedDirectoryHandle) {
      if (await verifyPermission(savedDirectoryHandle, true)) {
        setDirectoryHandle(savedDirectoryHandle);
        setFolderPermOk(true);
        showToast('폴더 연결 성공!');
      } else {
        showToast('폴더 권한이 거부되었습니다.', 'error');
      }
    }
  };

  const handleSelectFolder = async () => {
    if (!(window as any).showDirectoryPicker) {
      showToast('현재 브라우저 환경에서는 폴더 선택 기능을 지원하지 않습니다.', 'error');
      return;
    }
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setDirectoryHandle(handle);
      setSavedDirectoryHandle(handle);
      setDBItem('dirHandle', handle);
      setFolderPermOk(true);
      showToast('새로운 저장 폴더가 선택되었습니다.');
    } catch (err: any) {
      if (err.name !== 'AbortError') showToast('폴더 선택 중 취소되었거나 오류가 발생했습니다.', 'error');
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen font-sans text-gray-800 flex flex-col items-center">
      {/* Toast Container */}
      <div id="toastContainer" className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex flex-col gap-2 z-50">
        {toasts.map(toast => (
          <div key={toast.id} className={`flex items-center gap-3 px-5 py-3 text-white rounded-xl shadow-lg toast-animate text-sm font-medium z-[9999] ${toast.type === 'success' ? 'bg-gray-800' : 'bg-red-600'}`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <AlertCircle className="w-5 h-5 text-white" />}
            {toast.message}
          </div>
        ))}
      </div>

      {showPermissionModal && (
        <div className="fixed inset-0 z-[200] modal-backdrop flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 text-center">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">필수 권한 설정</h2>
                <p className="text-gray-600 text-sm">앱 사용을 위해 카메라 및 폴더 접근 권한이 필요합니다.</p>
            </div>
            <div className="p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${cameraPermOk === true ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                            <Camera className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="font-medium text-gray-800">카메라 접근</p>
                            <p className={`text-xs ${cameraPermOk === true ? 'text-green-600' : cameraPermOk === 'failed' ? 'text-red-500' : 'text-gray-500'}`}>
                              {cameraPermOk === true ? '허용됨' : cameraPermOk === 'skipped' ? '카메라 없이 진행합니다.' : cameraPermOk === 'failed' ? '카메라를 찾을 수 없습니다' : '사진 촬영을 위해 필요합니다.'}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleRequestCamera} disabled={cameraPermOk === true || cameraPermOk === 'skipped'} className={`px-4 py-2 text-white text-sm font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap ${(cameraPermOk === true) ? 'bg-green-600 hover:bg-green-700' : (cameraPermOk === 'failed' ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700')}`}>
                        {cameraPermOk === true ? '완료' : cameraPermOk === 'skipped' ? '건너뜀' : cameraPermOk === 'failed' ? '건너뛰기' : '권한 허용'}
                    </button>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${folderPermOk ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                            <FolderLock className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="font-medium text-gray-800">저장 폴더 연결</p>
                            <p className={`text-xs ${folderPermOk ? 'text-green-600' : 'text-gray-500'}`}>
                              {folderPermOk ? (directoryHandle ? '연결됨' : '건너뜀 (기록 없음)') : '사진 저장을 위해 필요합니다.'}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleRequestFolder} disabled={folderPermOk || !savedDirectoryHandle} className={`px-4 py-2 text-white text-sm font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap ${folderPermOk ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                        {folderPermOk ? '완료' : '연결하기'}
                    </button>
                </div>
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
                <button onClick={() => setShowPermissionModal(false)} disabled={!((cameraPermOk === true || cameraPermOk === 'skipped') && folderPermOk)} className="w-full px-6 py-3 text-white font-bold rounded-xl transition-colors shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700">
                    {((cameraPermOk === true || cameraPermOk === 'skipped') && folderPermOk) ? '앱 시작하기' : '모든 권한 허용됨 - 앱 시작하기'}
                </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8 flex flex-col gap-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 lg:w-2/3 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col min-h-[500px]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
                  <Camera className="w-5 h-5 text-blue-600" />
                  사진 촬영
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={captureImage} className="p-2 flex items-center gap-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-sm px-4" title="사진 촬영 및 저장">
                    <Aperture className="w-4 h-4" />
                    <span className="text-sm font-bold hidden sm:inline">촬영</span>
                </button>
                <button onClick={() => {
                  setFacingMode(prev => {
                    const newMode = prev === 'user' ? 'environment' : 'user';
                    localStorage.setItem('cameraFacingMode', newMode);
                    return newMode;
                  });
                  startCamera(true);
                }} className="p-2 bg-white border border-gray-200 rounded-full hover:bg-gray-100 transition-colors shadow-sm" title="카메라 전환">
                    <SwitchCamera className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>
          
            <div className="p-4 flex-1 flex flex-col items-center justify-center bg-gray-100 relative">
              <div ref={containerRef} className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden shadow-inner flex items-center justify-center">
                  <video 
                    ref={videoRef} 
                    className="absolute w-full h-full object-cover origin-center pointer-events-none" 
                    style={{ transform: `scaleX(${facingMode === 'user' ? -1 : 1}) scale(${zoom})`, filter: `brightness(${100 + cameraBrightness}%) contrast(${100 + cameraContrast}%)` }}
                    autoPlay 
                    playsInline 
                  />
                  
                  {flash && <div className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-200 opacity-100" />}

                  <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
                      <div ref={guideRef} className="guide-overlay border-[3px] border-green-400 absolute cursor-move pointer-events-auto" style={{ width: 240, height: 320, top: '10%', left: '50%', transform: guideRef.current?.style.transform?.includes('translate') ? 'translateX(-50%)' : 'none' }}>
                          <div className="absolute inset-0 opacity-60 pointer-events-none">
                              <div className="w-full h-[1px] bg-white absolute top-1/3"></div>
                              <div className="w-full h-[1px] bg-white absolute top-2/3"></div>
                              <div className="h-full w-[1px] bg-white absolute left-1/3"></div>
                              <div className="h-full w-[1px] bg-white absolute left-2/3"></div>
                          </div>
                          <div className="absolute top-0 left-0 w-full text-center mt-2 text-white text-xs font-bold tracking-wider pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">드래그(이동) / 모서리(크기 조절)</div>
                          <div className="resize-handle hover:scale-125 transition-transform" ref={guideHandleRef}></div>
                      </div>
                  </div>

                  {isCameraLoading && (
                    <div className="absolute inset-0 bg-black flex flex-col items-center justify-center z-20 text-white">
                        <Loader2 className="w-8 h-8 animate-spin mb-2 text-blue-500" />
                        <span className="text-sm">카메라를 불러오는 중...</span>
                    </div>
                  )}
                  {showNoCameraFallback && (
                    <div className="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center z-30 text-white">
                        <CameraOff className="w-12 h-12 mb-4 text-gray-400" />
                        <p className="mb-4 text-center text-sm px-4">카메라를 찾을 수 없습니다.</p>
                    </div>
                  )}
              </div>

              <div className="w-full mt-4 bg-white p-3 rounded-xl shadow-sm border border-gray-200 relative z-30 flex items-center justify-between gap-4">
                  <div className="flex-1 flex items-center gap-2">
                      <ZoomOut className="w-4 h-4 text-gray-500 shrink-0" title="축소" />
                      <input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                      <ZoomIn className="w-4 h-4 text-gray-500 shrink-0" title="확대" />
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                      <div className="flex items-center gap-2 w-full">
                          <label className="text-xs font-medium text-gray-600 w-8">밝기</label>
                          <input type="range" min="-50" max="50" value={cameraBrightness} onChange={(e) => setCameraBrightness(parseInt(e.target.value))} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                      </div>
                  </div>
                  <div className="flex-1 flex flex-col justify-center">
                      <div className="flex items-center gap-2 w-full">
                          <label className="text-xs font-medium text-gray-600 w-8">대비</label>
                          <input type="range" min="-50" max="50" value={cameraContrast} onChange={(e) => setCameraContrast(parseInt(e.target.value))} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                      </div>
                  </div>
                  <button onClick={() => { setZoom(1); setCameraBrightness(0); setCameraContrast(0); }} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors rounded-lg flex-shrink-0" title="설정 초기화">
                      <RotateCcw className="w-4 h-4" />
                  </button>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-80 flex flex-col gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <UserSquare2 className="w-5 h-5 text-blue-600" />
                  회원 정보 입력
              </h3>
              
              <div className="space-y-4">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">성함</label>
                      <input type="text" value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="미입력시 '미상' 지정" className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" />
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">회원 번호</label>
                      <input type="text" value={memberId} onChange={handleMemberIdChange} placeholder="예: 2026-00001" maxLength={10} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" />
                  </div>
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-xs text-blue-800 font-medium">저장 파일명 미리보기:</p>
                  <p className="text-sm font-mono text-gray-700 mt-1 truncate">{currentFilenamePreview}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
                  <FolderOutput className="w-5 h-5 text-blue-600" />
                  저장 설정
              </h3>
              
              <div className="flex flex-col gap-3">
                  <button onClick={handleRequestFolder} disabled={!savedDirectoryHandle || !!directoryHandle} className={`w-full flex items-center justify-center gap-2 px-4 py-3 text-white rounded-xl font-bold transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-400 disabled:cursor-not-allowed ${directoryHandle ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                      <FolderKey className="w-5 h-5" />
                      <span>{directoryHandle ? `[ ${directoryHandle.name} ] 폴더 연결됨` : savedDirectoryHandle ? `[ ${savedDirectoryHandle.name} ] 폴더 연결` : '저장 폴더 자동 연결'}</span>
                  </button>

                  <button onClick={handleSelectFolder} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border-2 border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 hover:border-gray-400 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-gray-200">
                      <FolderSearch className="w-4 h-4" />
                      다른 폴더로 변경하기
                  </button>
              </div>

              <p className="text-xs text-gray-500 mt-3 text-center break-words">
                  {directoryHandle ? <><span className="text-blue-600 font-medium">연결됨:</span> {directoryHandle.name}</> : '연결된 폴더가 없습니다. (기본 다운로드 폴더 사용)'}
              </p>
            </div>

            <button onClick={captureImage} className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 font-bold text-lg transition-all shadow-md hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-300 active:scale-[0.98]">
              <Aperture className="w-6 h-6" />
              사진 촬영 및 저장
            </button>

            <canvas ref={canvasRef} className="hidden"></canvas>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 w-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                <h3 className="font-medium text-gray-800 flex items-center gap-2">
                    <Images className="w-5 h-5 text-blue-600" />
                    저장된 사진 목록
                </h3>
                
                <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-2 max-w-[150px] sm:max-w-[200px]" title="브라우저 보안상 전체 경로는 숨겨지며 폴더명만 표시됩니다.">
                        {directoryHandle ? <><FolderCheck className="w-4 h-4 text-blue-500 shrink-0" /><span className="truncate font-medium text-blue-700">{directoryHandle.name}</span></> : <><FolderIcon className="w-4 h-4 text-gray-500 shrink-0" /><span className="truncate">기본 다운로드</span></>}
                    </div>

                    <select value={sortMode} onChange={(e) => { setSortMode(e.target.value); localStorage.setItem('gallerySortMode', e.target.value); }} className="text-sm bg-gray-50 border border-gray-300 text-gray-700 rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none">
                        <option value="date-desc">최신순 (날짜 내림차순)</option>
                        <option value="date-asc">오래된순 (날짜 오름차순)</option>
                        <option value="name-asc">이름순 (가나다)</option>
                        <option value="name-desc">이름 역순</option>
                    </select>

                    <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200">
                        <button onClick={() => { setViewMode('grid'); localStorage.setItem('galleryViewMode', 'grid'); }} className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`} title="썸네일 보기"><Grid className="w-4 h-4" /></button>
                        <button onClick={() => { setViewMode('list'); localStorage.setItem('galleryViewMode', 'list'); }} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`} title="목록 보기"><List className="w-4 h-4" /></button>
                    </div>

                    <button onClick={() => { updateGallery(); showToast('목록 새로고침'); }} className="p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-200" title="목록 새로고침">
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </div>
            
            <div className={viewMode === 'grid' ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 min-h-[160px] bg-gray-50 rounded-xl p-4 border border-gray-100 items-start" : "flex flex-col gap-2 min-h-[160px] bg-gray-50 rounded-xl p-4 border border-gray-100"}>
                {galleryItems.length === 0 ? (
                  <div className="col-span-full flex flex-col items-center justify-center py-6 gap-4">
                      <p className="text-sm text-gray-500">저장된 사진이 없습니다.</p>
                  </div>
                ) : (
                  galleryItems.map((item, idx) => {
                    const dateStr = new Date(item.lastModified).toLocaleString();
                    if (viewMode === 'grid') {
                      return (
                        <div key={idx} className="relative flex flex-col gap-2 p-2 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all group cursor-pointer" onClick={() => handleOpenEditor(item.url, item.name)}>
                          <button className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-600 text-white p-1.5 rounded-full z-20 opacity-0 group-hover:opacity-100 transition-opacity" title="삭제" onClick={(e) => deleteFile(e, item.name, item.isSession)}>
                              <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <div className="relative w-full aspect-[3/4] bg-gray-100 rounded-lg overflow-hidden">
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 z-10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                  <Edit3 className="text-white w-6 h-6 shadow-sm" />
                              </div>
                              <img src={item.url} className="w-full h-full object-cover" alt={item.name} />
                          </div>
                          <p className="text-xs text-center text-gray-700 truncate px-1 font-medium" title={item.name}>{item.name}</p>
                        </div>
                      )
                    } else {
                      return (
                        <div key={idx} className="flex items-center gap-4 p-2 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer group" onClick={() => handleOpenEditor(item.url, item.name)}>
                            <div className="w-12 h-16 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                                <img src={item.url} className="w-full h-full object-cover" alt="썸네일" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                                <p className="text-xs text-gray-500">{dateStr}</p>
                            </div>
                            <button className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" onClick={(e) => deleteFile(e, item.name, item.isSession)}>
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                      )
                    }
                  })
                )}
            </div>
        </div>
      </div>

      {showEditor && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex flex-col items-center justify-center p-4 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2"><Sliders className="w-5 h-5 text-blue-600" />사진 편집 및 제단</h3>
                  <button onClick={() => setShowEditor(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-4 bg-gray-100 flex items-center justify-center h-96 relative overflow-hidden">
                  <div ref={editWorkAreaRef} className="relative inline-block max-h-full max-w-full shadow-sm rounded overflow-hidden">
                      <img ref={editImageRef} src={editImageSrc} className="block max-h-full max-w-full pointer-events-none object-contain select-none" draggable={false} style={{ filter: `brightness(${100 + editBrightness}%) contrast(${100 + editContrast}%)` }} />
                      
                      <div ref={editGuideRef} className="guide-overlay border-[3px] border-blue-400 absolute cursor-move pointer-events-auto" style={{ width: 150, height: 200, left: '10%', top: '10%' }}>
                          <div className="absolute inset-0 opacity-60 pointer-events-none">
                              <div className="w-full h-[1px] bg-white absolute top-1/3"></div>
                              <div className="w-full h-[1px] bg-white absolute top-2/3"></div>
                              <div className="h-full w-[1px] bg-white absolute left-1/3"></div>
                              <div className="h-full w-[1px] bg-white absolute left-2/3"></div>
                          </div>
                          <div className="resize-handle hover:scale-125 transition-transform" ref={editGuideHandleRef}></div>
                      </div>
                  </div>
              </div>
              <div className="p-5 flex flex-col gap-4 overflow-y-auto">
                  <div className="flex gap-4">
                      <div className="flex-1">
                          <label className="flex justify-between text-sm font-medium text-gray-700 mb-2"><span>밝기</span><span>{editBrightness}</span></label>
                          <input type="range" min="-50" max="50" value={editBrightness} onChange={e => setEditBrightness(parseInt(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                      </div>
                      <div className="flex-1">
                          <label className="flex justify-between text-sm font-medium text-gray-700 mb-2"><span>대비</span><span>{editContrast}</span></label>
                          <input type="range" min="-50" max="50" value={editContrast} onChange={e => setEditContrast(parseInt(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                      </div>
                  </div>
                  <button onClick={saveEdit} className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold transition-all shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-300">
                      <Scissors className="w-5 h-5" />제단 및 편집본 저장
                  </button>
              </div>
          </div>
        </div>
      )}

    </div>
  );
}
