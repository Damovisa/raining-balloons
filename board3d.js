import * as THREE from './vendor/three.module.js';

const COLORS = [0xd85149, 0x498ac5, 0x619b6b, 0xe9b54c];
const NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
const TAU = Math.PI * 2;
const ELEVATION = 70 * Math.PI / 180;
const YAW = 0.28;
const cosmetic = n => {
    const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
};
const cellKey = (row, col) => `${row},${col}`;
const peepKey = (player, peep) => `${player}:${peep}`;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

window.Board3D = class Board3D {
    constructor(container, { onCellClick = () => {}, onCameraChange = () => {} } = {}) {
        if (!container) throw new Error('Board3D requires a board container.');
        this.container = container;
        this.onCellClick = onCellClick;
        this.onCameraChange = onCameraChange;
        this.canvas = document.createElement('canvas');
        const options = { alpha: false, antialias: true, powerPreference: 'low-power' };
        const context = this.canvas.getContext('webgl2', options);
        if (!context) throw new Error('WebGL2 is unavailable; use the 2D board.');
        try {
            this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context, ...options });
        } catch (error) {
            context.getExtension('WEBGL_lose_context')?.loseContext();
            throw new Error('The 3D board could not initialize.', { cause: error });
        }
        this.disposed = false;
        this.frame = 0;
        this.lastTime = 0;
        this.geometries = new Map();
        this.materials = new Map();
        this.textures = new Map();
        this.people = new Map();
        this.bunkers = new Map();
        this.hitPoses = new Map();
        this.completions = new Set();
        this.effects = [];
        this.tiles = [];
        this.pickables = [];
        this.cellDescriptions = [];
        this.listeners = [];
        this.focusCell = { row: 0, col: 0 };
        this.yaw = YAW;
        this.elevation = ELEVATION;
        this.cameraChanged = false;
        this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = this.motion.matches;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x172839);
        this.camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 60);
        this.raycaster = new THREE.Raycaster();
        this.pointerVector = new THREE.Vector2();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        try {
            this.buildScene();
            this.mount();
            this.bindInput();
            this.screen = container.closest('#game-screen') || container;
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(container);
            this.visibilityObserver = new MutationObserver(() => this.updateVisibility());
            for (let ancestor = container; ancestor; ancestor = ancestor.parentElement) {
                this.visibilityObserver.observe(ancestor, {
                    attributes: true, attributeFilter: ['class', 'style', 'hidden']
                });
            }
            this.listen(document, 'visibilitychange', () => this.updateVisibility());
            this.listen(this.motion, 'change', event => {
                this.reducedMotion = event.matches;
                this.rain.visible = !this.reducedMotion;
                this.wake();
            });
            this.resize();
            this.updateVisibility();
        } catch (error) {
            this.dispose();
            throw new Error('The 3D board could not initialize.', { cause: error });
        }
    }

    geometry(name, create) {
        if (!this.geometries.has(name)) this.geometries.set(name, create());
        return this.geometries.get(name);
    }

    material(color, options = {}) {
        const key = `${color}:${JSON.stringify(options)}`;
        if (!this.materials.has(key)) {
            this.materials.set(key, new THREE.MeshStandardMaterial({
                color, roughness: 0.82, ...options
            }));
        }
        return this.materials.get(key);
    }

    box(parent, color, size, position, options = {}) {
        return this.mesh(parent, this.geometry('box', () => new THREE.BoxGeometry(1, 1, 1)),
            this.material(color, options), size, position);
    }

    mesh(parent, geometry, material, size = [1, 1, 1], position = [0, 0, 0]) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(...size);
        mesh.position.set(...position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    }

    sphere(parent, color, size, position) {
        return this.mesh(parent,
            this.geometry('sphere', () => new THREE.SphereGeometry(1, 10, 7)),
            this.material(color), size, position);
    }

    cylinder(parent, color, size, position) {
        return this.mesh(parent,
            this.geometry('cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 10)),
            this.material(color), size, position);
    }

    bevel(parent, color, width, height, depth, position) {
        const radius = 0.055;
        const key = `bevel:${width}:${height}:${depth}`;
        const geometry = this.geometry(key, () => {
            const shape = new THREE.Shape();
            const x = width / 2 - radius;
            const z = depth / 2 - radius;
            shape.moveTo(-x, -z);
            shape.lineTo(x, -z);
            shape.lineTo(x, z);
            shape.lineTo(-x, z);
            shape.closePath();
            const result = new THREE.ExtrudeGeometry(shape, {
                depth: height - radius * 2, steps: 1, bevelEnabled: true,
                bevelSize: radius, bevelThickness: radius, bevelSegments: 1
            });
            result.rotateX(-Math.PI / 2);
            result.translate(0, radius - height / 2, 0);
            return result;
        });
        return this.mesh(parent, geometry, this.material(color), [1, 1, 1], position);
    }

    ring(parent, color, radius, thickness, position) {
        const geometry = this.geometry(`ring:${radius}:${thickness}`,
            () => new THREE.RingGeometry(radius - thickness, radius, 32));
        const result = this.mesh(parent, geometry,
            this.material(color, { side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 }),
            [1, 1, 1], position);
        result.rotation.x = -Math.PI / 2;
        result.castShadow = false;
        return result;
    }

    buildScene() {
        this.scene.add(new THREE.HemisphereLight(0xb6d5eb, 0x75513a, 2.2));
        const sun = new THREE.DirectionalLight(0xffd6a0, 3.8);
        sun.position.set(-5, 10, 6);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
        sun.shadow.normalBias = 0.025;
        sun.shadow.bias = -0.0003;
        this.scene.add(sun);
        const rim = new THREE.DirectionalLight(0x91b6ce, 1.6);
        rim.position.set(5, 5, -7);
        this.scene.add(rim);
        this.box(this.scene, 0x1c3040, [200, 0.1, 200], [0, -0.94, 0]);
        const board = new THREE.Group();
        this.scene.add(board);
        this.bevel(board, 0x62402d, 8.8, 0.6, 8.8, [0, -0.48, 0]);
        this.bevel(board, 0xb8894e, 8.86, 0.15, 8.86, [0, -0.19, 0]);
        this.bevel(board, 0x392f2b, 8.48, 0.16, 8.48, [0, -0.085, 0]);
        this.bevel(board, 0x47362d, 8.55, 0.13, 8.55, [0, -0.77, 0]);
        for (const x of [-3.6, 3.6]) {
            for (const z of [-3.6, 3.6]) {
                this.cylinder(board, 0x382d2a, [0.3, 0.18, 0.3], [x, -0.84, z]);
            }
        }
        // Thin inlaid wood grain, not an image or a second tile grid.
        for (let i = 0; i < 13; i++) {
            const h = -0.68 + i * 0.035;
            this.box(board, i % 3 ? 0x6e4930 : 0x795235,
                [8.5, 0.009, 0.006], [0, h, 4.399]);
            this.box(board, 0x795235, [0.006, 0.009, 8.5], [4.399, h, 0]);
        }
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const id = row * 8 + col;
                const green = row >= 2 && row <= 5 && col >= 2 && col <= 5;
                const palette = green ? [0x8d9f72, 0x96a67c, 0x85966c] : [0xccbda2, 0xd6c8af, 0xc7b79c];
                const tile = this.bevel(board, palette[Math.floor(cosmetic(id) * 3)],
                    0.97, 0.14, 0.97, [col - 3.5, 0.01, row - 3.5]);
                tile.userData.cell = { row, col };
                this.pickables.push(tile);
                const root = new THREE.Group();
                root.position.set(col - 3.5, 0.085, row - 3.5);
                board.add(root);
                const target = this.ring(root, 0xffd782, 0.36, 0.035, [0, 0.012, 0]);
                target.visible = false;
                const puddle = this.cylinder(root, 0x81b2be, [0.39, 0.008, 0.32], [0, 0.008, 0]);
                puddle.material = this.material(0x81b2be, {
                    transparent: true, opacity: 0.46, roughness: 0.2, depthWrite: false
                });
                puddle.castShadow = false;
                puddle.visible = false;
                this.tiles.push({ target, puddle });
                if (green) {
                    for (let blade = 0; blade < 3; blade++) {
                        const x = (cosmetic(id * 7 + blade) - 0.5) * 0.7;
                        const z = (cosmetic(id * 11 + blade) - 0.5) * 0.7;
                        const grass = this.box(root, 0x778c60, [0.012, 0.06, 0.02], [x, 0.025, z]);
                        grass.rotation.z = 0.35;
                        grass.castShadow = false;
                    }
                } else {
                    const fleck = this.box(root, 0xb5a78e, [0.10, 0.002, 0.025], [0.3, 0, -0.28]);
                    fleck.castShadow = false;
                }
            }
        }
        this.focusRing = this.ring(this.scene, 0xffe9b1, 0.45, 0.045, [-3.5, 0.11, -3.5]);
        this.focusRing.visible = false;
        this.createRain();
    }

    createRain() {
        const positions = new Float32Array(100 * 6);
        const geometry = this.geometry('rain', () => new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
            color: 0xc7dae3, transparent: true, opacity: 0.22, depthWrite: false
        });
        this.materials.set('rain', material);
        this.rain = new THREE.LineSegments(geometry, material);
        this.rain.frustumCulled = false;
        this.rain.visible = !this.reducedMotion;
        this.scene.add(this.rain);
        this.updateRain(0);
    }

    updateRain(time) {
        const attribute = this.rain.geometry.attributes.position;
        for (let i = 0; i < 100; i++) {
            const x = (cosmetic(i + 500) - 0.5) * 12;
            const z = (cosmetic(i + 800) - 0.5) * 12;
            const y = ((cosmetic(i + 1000) * 6 - time * 1.8) % 6 + 6) % 6 + 0.3;
            attribute.setXYZ(i * 2, x, y, z);
            attribute.setXYZ(i * 2 + 1, x + 0.026, y - 0.15, z);
        }
        attribute.needsUpdate = true;
    }

    createPerson(playerIndex, peepIndex) {
        const root = new THREE.Group();
        this.scene.add(root);
        const body = new THREE.Group();
        root.add(body);
        const jacket = COLORS[playerIndex % COLORS.length];
        const skin = [0xe7b78b, 0xbb825f, 0x80523c, 0xd69c76][(playerIndex + peepIndex) % 4];
        const hair = [0x3a2c28, 0x865d37, 0x29282c, 0xb28249][(playerIndex * 2 + peepIndex) % 4];
        this.bevel(body, jacket, 0.29, 0.29, 0.23, [0, 0.47, 0]);
        this.box(body, 0xead6b2, [0.017, 0.22, 0.016], [0, 0.48, 0.123]);
        this.box(body, jacket, [0.32, 0.035, 0.245], [0, 0.345, 0]);
        this.box(body, 0xe2cab0, [0.15, 0.035, 0.05], [0, 0.62, 0.03]);
        for (let i = 0; i < 3; i++) {
            this.sphere(body, 0xdec7a0, [0.013, 0.013, 0.011], [0.028, 0.42 + i * 0.065, 0.136]);
        }
        for (const side of [-1, 1]) {
            this.box(body, 0x54483f, [0.055, 0.009, 0.009], [side * 0.085, 0.44, 0.124]);
        }
        this.cylinder(body, skin, [0.055, 0.08, 0.055], [0, 0.65, 0]);
        const head = new THREE.Group();
        head.position.y = 0.79;
        body.add(head);
        this.sphere(head, skin, [0.135, 0.16, 0.125], [0, 0, 0]);
        for (const side of [-1, 1]) {
            this.sphere(head, skin, [0.03, 0.043, 0.025], [side * 0.129, -0.008, 0]);
            this.sphere(head, 0xf5ebd7, [0.029, 0.027, 0.016], [side * 0.047, 0.025, 0.11]);
            this.sphere(head, 0x28313a, [0.012, 0.016, 0.008], [side * 0.047, 0.024, 0.125]);
            this.box(head, hair, [0.045, 0.012, 0.015], [side * 0.047, 0.064, 0.11]);
        }
        this.sphere(head, skin, [0.026, 0.029, 0.036], [0, -0.015, 0.132]);
        this.box(head, 0x8b5147, [0.045, 0.009, 0.008], [0, -0.065, 0.112]);
        this.sphere(head, hair, [0.139, 0.09, 0.128], [0, 0.11, -0.018]);
        const style = (playerIndex + peepIndex) % 3;
        if (style === 0) {
            const fringe = this.box(head, hair, [0.17, 0.064, 0.07], [-0.024, 0.107, 0.078]);
            fringe.rotation.z = 0.18;
            this.box(head, hair, [0.035, 0.10, 0.10], [-0.115, 0.03, -0.015]);
        } else if (style === 1) {
            for (let i = 0; i < 5; i++) {
                this.sphere(head, hair, [0.065, 0.067, 0.064],
                    [(i - 2) * 0.048, 0.12 + Math.sin(i) * 0.02, 0.036]);
            }
        } else {
            this.sphere(head, hair, [0.075, 0.075, 0.078], [0, 0.1, -0.13]);
            this.box(head, hair, [0.036, 0.12, 0.08], [0.114, 0.012, -0.035]);
        }
        const arms = [];
        const legs = [];
        for (const side of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(side * 0.185, 0.57, 0);
            body.add(arm);
            this.box(arm, jacket, [0.094, 0.2, 0.11], [0, -0.087, 0]);
            this.box(arm, 0xe2cab0, [0.098, 0.028, 0.113], [0, -0.18, 0]);
            this.sphere(arm, skin, [0.052, 0.057, 0.052], [0, -0.226, 0.012]);
            arms.push(arm);
            const leg = new THREE.Group();
            leg.position.set(side * 0.084, 0.34, 0);
            body.add(leg);
            this.box(leg, 0x35434a, [0.106, 0.23, 0.115], [0, -0.11, 0]);
            this.bevel(leg, 0x3a302c, 0.125, 0.12, 0.19, [0, -0.25, 0.035]);
            legs.push(leg);
        }
        const umbrella = this.createUmbrella(body, jacket);
        umbrella.visible = false;
        const moved = this.ring(root, 0xd4c6a7, 0.29, 0.022, [0, 0.012, 0]);
        moved.visible = false;
        // A small physical check mark stays readable independently of jacket colors.
        const check = new THREE.Group();
        moved.add(check);
        const tickA = this.box(check, 0xffedc6, [0.04, 0.13, 0.018], [-0.06, -0.30, 0]);
        tickA.rotation.z = 0.65;
        const tickB = this.box(check, 0xffedc6, [0.04, 0.23, 0.018], [0.035, -0.25, 0]);
        tickB.rotation.z = -0.6;
        const person = {
            root, body, head, arms, legs, umbrella, moved,
            phase: cosmetic(playerIndex * 10 + peepIndex) * TAU,
            target: new THREE.Vector3(), from: new THREE.Vector3(),
            moveStart: 0, moving: false, facing: playerIndex === 0 ? 0 : Math.PI,
            hasUmbrella: false, inBunker: false
        };
        body.rotation.y = person.facing;
        return person;
    }

    createUmbrella(parent, color) {
        const root = new THREE.Group();
        root.position.set(0.20, 0, 0.03);
        parent.add(root);
        this.cylinder(root, 0xd9bd7d, [0.014, 0.88, 0.014], [0, 0.91, 0]);
        const canopyGeometry = this.geometry('canopy', () => {
            const result = new THREE.ConeGeometry(0.41, 0.20, 8, 1, true);
            result.translate(0, 1.34, 0);
            return result;
        });
        this.mesh(root, canopyGeometry, this.material(color, { side: THREE.DoubleSide }));
        this.sphere(root, 0xead4a3, [0.032, 0.037, 0.032], [0, 1.455, 0]);
        for (let i = 0; i < 8; i++) {
            const a = i * TAU / 8;
            const rib = this.cylinder(root, 0xedd5ac, [0.008, 0.455, 0.008],
                [Math.sin(a) * 0.205, 1.34, Math.cos(a) * 0.205]);
            rib.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(Math.sin(a) * 0.41, -0.2, Math.cos(a) * 0.41).normalize());
        }
        return root;
    }

    createBunker(row, col) {
        const root = new THREE.Group();
        root.position.set(col - 3.5, 0.08, row - 3.5);
        root.userData.cell = { row, col };
        this.scene.add(root);
        this.bevel(root, 0x737d76, 0.87, 0.14, 0.85, [0, 0.035, 0]);
        this.bevel(root, 0xa2aa99, 0.15, 0.68, 0.76, [-0.36, 0.40, 0]);
        this.bevel(root, 0xa2aa99, 0.15, 0.68, 0.76, [0.36, 0.40, 0]);
        this.box(root, 0x899585, [0.63, 0.67, 0.13], [0, 0.40, -0.32]);
        this.box(root, 0xd0c8af, [0.78, 0.09, 0.12], [0, 0.73, 0.33]);
        this.box(root, 0x67756a, [0.055, 0.58, 0.05], [-0.265, 0.36, 0.33]);
        this.box(root, 0x67756a, [0.055, 0.58, 0.05], [0.265, 0.36, 0.33]);
        // The rear roof remains solid; the front roof lifts away for occupied bunkers.
        this.bevel(root, 0xb5b7a3, 0.94, 0.14, 0.34, [0, 0.81, -0.28]);
        const roof = this.bevel(root, 0xb5b7a3, 0.94, 0.14, 0.55, [0, 0.81, 0.155]);
        this.box(root, 0x657568, [0.23, 0.07, 0.17], [0.19, 0.92, -0.29]);
        for (let i = 0; i < 4; i++) {
            this.box(root, 0x364c45, [0.13, 0.016, 0.012], [0.19, 0.932, -0.345 + i * 0.035]);
        }
        this.box(root, 0xe2bd6c, [0.18, 0.04, 0.025], [0, 0.69, 0.401], {
            emissive: 0xe2bd6c, emissiveIntensity: 0.3
        });
        for (const side of [-1, 1]) {
            for (let i = 0; i < 3; i++) {
                this.box(root, 0x7b877a, [0.007, 0.012, 0.58], [side * 0.438, 0.22 + i * 0.18, 0]);
            }
        }
        const badge = new THREE.Sprite();
        badge.position.set(0, 1.17, -0.18);
        badge.scale.set(0.33, 0.33, 1);
        badge.visible = false;
        // Sprite's default material is per-instance, unlike our pooled materials.
        badge.material.dispose();
        badge.material = this.badgeMaterial(3);
        root.add(badge);
        return { root, roof, badge };
    }

    badgeMaterial(turns) {
        const label = String(turns);
        const key = `badge:${label}`;
        if (!this.materials.has(key)) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 64;
            const context = canvas.getContext('2d');
            context.fillStyle = '#233b3d';
            context.beginPath();
            context.arc(32, 32, 29, 0, TAU);
            context.fill();
            context.strokeStyle = '#e2bf7c';
            context.lineWidth = 3;
            context.stroke();
            context.fillStyle = '#fff1cb';
            context.font = 'bold 40px system-ui, sans-serif';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label, 32, 34);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            this.textures.set(key, texture);
            this.materials.set(key, new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
        }
        return this.materials.get(key);
    }

    mount() {
        this.originalStyle = this.container.getAttribute('style');
        Object.assign(this.container.style, { display: 'block', position: 'relative', background: '#172839' });
        this.canvas.className = 'board3d-canvas';
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute('role', 'application');
        this.canvas.setAttribute('aria-label',
            'Raining Balloons 3D board. Arrow keys navigate tiles. Enter or Space selects. Drag to orbit.');
        Object.assign(this.canvas.style, {
            display: 'block', width: '100%', height: '100%', touchAction: 'none',
            outlineOffset: '-4px', cursor: 'grab'
        });
        this.status = document.createElement('span');
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');
        this.status.setAttribute('aria-atomic', 'true');
        Object.assign(this.status.style, {
            position: 'absolute', width: '1px', height: '1px', padding: '0',
            overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap'
        });
        this.container.append(this.canvas, this.status);
    }

    listen(target, name, handler, options) {
        target.addEventListener(name, handler, options);
        this.listeners.push(() => target.removeEventListener(name, handler, options));
    }

    bindInput() {
        this.listen(this.canvas, 'contextmenu', event => event.preventDefault());
        this.listen(this.canvas, 'pointerdown', event => {
            if (!event.isPrimary || this.gesture) {
                if (this.gesture) this.gesture.cancelled = true;
                return;
            }
            if (event.button !== 0) return;
            this.canvas.focus({ preventScroll: true });
            this.gesture = {
                id: event.pointerId, x: event.clientX, y: event.clientY,
                lastX: event.clientX, lastY: event.clientY, dragging: false, cancelled: false,
                cell: this.pickCell(event.clientX, event.clientY)
            };
            try {
                this.canvas.setPointerCapture(event.pointerId);
            } catch {
                this.cancelGesture();
            }
        });
        this.listen(this.canvas, 'pointermove', event => {
            const gesture = this.gesture;
            if (!gesture || gesture.id !== event.pointerId || gesture.cancelled) return;
            if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
                gesture.dragging = true;
                this.canvas.style.cursor = 'grabbing';
            }
            if (gesture.dragging) {
                this.yaw -= (event.clientX - gesture.lastX) * 0.007;
                this.elevation = clamp(this.elevation + (event.clientY - gesture.lastY) * 0.006,
                    35 * Math.PI / 180, 85 * Math.PI / 180);
                this.fitCamera();
                this.notifyCamera();
                this.wake();
            }
            gesture.lastX = event.clientX;
            gesture.lastY = event.clientY;
        });
        this.listen(this.canvas, 'pointerup', event => {
            const gesture = this.gesture;
            if (!gesture || gesture.id !== event.pointerId) return;
            const endCell = this.pickCell(event.clientX, event.clientY);
            const select = !gesture.dragging && !gesture.cancelled &&
                Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) <= 6 &&
                gesture.cell && endCell &&
                gesture.cell.row === endCell.row && gesture.cell.col === endCell.col;
            this.cancelGesture();
            if (select) {
                this.focusCell = endCell;
                this.updateFocus();
                this.onCellClick(endCell.row, endCell.col);
            }
        });
        this.listen(this.canvas, 'pointercancel', () => this.cancelGesture());
        this.listen(this.canvas, 'lostpointercapture', () => this.cancelGesture());
        this.listen(window, 'blur', () => this.cancelGesture());
        this.listen(this.canvas, 'focus', () => {
            this.focusRing.visible = true;
            this.updateFocus();
        });
        this.listen(this.canvas, 'blur', () => {
            this.focusRing.visible = false;
            this.cancelGesture();
            this.wake();
        });
        this.listen(this.canvas, 'keydown', event => {
            const deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
            const delta = deltas[event.key];
            if (delta) {
                event.preventDefault();
                this.focusCell = {
                    row: clamp(this.focusCell.row + delta[0], 0, 7),
                    col: clamp(this.focusCell.col + delta[1], 0, 7)
                };
                this.updateFocus();
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!event.repeat) this.onCellClick(this.focusCell.row, this.focusCell.col);
            } else if (event.key === 'Escape') {
                this.cancelGesture();
            }
        });
    }

    cancelGesture() {
        const gesture = this.gesture;
        this.gesture = null;
        if (gesture && this.canvas.hasPointerCapture(gesture.id)) {
            this.canvas.releasePointerCapture(gesture.id);
        }
        this.canvas.style.cursor = 'grab';
    }

    pickCell(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            return null;
        }
        this.pointerVector.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
        this.scene.updateMatrixWorld(true);
        this.camera.updateMatrixWorld(true);
        this.raycaster.setFromCamera(this.pointerVector, this.camera);
        const roots = [...this.pickables, ...Array.from(this.people.values(), item => item.root),
            ...Array.from(this.bunkers.values(), item => item.root)];
        for (const hit of this.raycaster.intersectObjects(roots, true)) {
            let object = hit.object;
            let visible = true;
            let cell = null;
            while (object) {
                if (!object.visible) visible = false;
                if (object.userData.cell) cell = object.userData.cell;
                object = object.parent;
            }
            if (visible && cell) return { ...cell };
        }
        return null;
    }

    updateFocus() {
        const { row, col } = this.focusCell;
        this.focusRing.position.set(col - 3.5, 0.115, row - 3.5);
        const description = this.cellDescriptions[row * 8 + col] || 'Empty tile';
        this.status.textContent = `Row ${row + 1}, column ${col + 1}. ${description}.`;
        this.wake();
    }

    reset() {
        if (this.disposed) return;
        this.cancelGesture();
        this.yaw = YAW;
        this.elevation = ELEVATION;
        this.fitCamera();
        this.notifyCamera();
        this.wake();
    }

    notifyCamera() {
        const yawDifference = Math.atan2(Math.sin(this.yaw - YAW), Math.cos(this.yaw - YAW));
        const changed = Math.abs(yawDifference) > 0.001 || Math.abs(this.elevation - ELEVATION) > 0.001;
        if (changed !== this.cameraChanged) {
            this.cameraChanged = changed;
            this.onCameraChange(changed);
        }
    }

    resize() {
        if (this.disposed) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return;
        this.width = width;
        this.height = height;
        this.renderer.setSize(width, height, false);
        this.fitCamera();
        this.wake();
    }

    fitCamera() {
        const distance = 16;
        const target = new THREE.Vector3(0, 0.4, 0);
        this.camera.position.set(
            Math.sin(this.yaw) * Math.cos(this.elevation) * distance,
            Math.sin(this.elevation) * distance + target.y,
            Math.cos(this.yaw) * Math.cos(this.elevation) * distance
        );
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld(true);
        const inverse = this.camera.quaternion.clone().invert();
        let horizontal = 0;
        let vertical = 0;
        for (const x of [-4.5, 4.5]) {
            for (const z of [-4.5, 4.5]) {
                for (const y of [-0.95, 1.65]) {
                    const corner = new THREE.Vector3(x, y, z).sub(target).applyQuaternion(inverse);
                    horizontal = Math.max(horizontal, Math.abs(corner.x));
                    vertical = Math.max(vertical, Math.abs(corner.y));
                }
            }
        }
        const aspect = (this.width || 1) / (this.height || 1);
        const halfHeight = Math.max(vertical, horizontal / aspect) * 1.065;
        Object.assign(this.camera, {
            left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight
        });
        this.camera.updateProjectionMatrix();
    }

    cellScreenPosition(row, col) {
        const projected = new THREE.Vector3(col - 3.5, 0.1, row - 3.5).project(this.camera);
        const rect = this.canvas.getBoundingClientRect();
        return { x: rect.left + (projected.x + 1) * rect.width / 2,
            y: rect.top + (1 - projected.y) * rect.height / 2 };
    }

    render(state) {
        if (this.disposed) return;
        const now = performance.now();
        const splashChanged = state.splashedCells !== this.splashIdentity;
        if (splashChanged) {
            this.splashIdentity = state.splashedCells;
            this.hitPoses.clear();
            this.clearEffects();
        }
        const splashes = new Set((state.splashedCells || []).map(cell => cellKey(cell.row, cell.col)));
        const targets = new Set((state.moveTargets || []).map(cell => cellKey(cell.row, cell.col)));
        this.cellDescriptions = Array.from({ length: 64 }, (_, index) => {
            const key = cellKey(Math.floor(index / 8), index % 8);
            const parts = [];
            if (targets.has(key)) parts.push('Available target');
            if (splashes.has(key)) parts.push('Splashed');
            this.tiles[index].target.visible = targets.has(key);
            this.tiles[index].puddle.visible = splashes.has(key);
            return parts;
        });
        const bunkerKeys = new Set();
        for (const bunker of state.bunkers || []) {
            const key = cellKey(bunker.row, bunker.col);
            bunkerKeys.add(key);
            let model = this.bunkers.get(key);
            if (!model) {
                model = this.createBunker(bunker.row, bunker.col);
                this.bunkers.set(key, model);
            }
            model.roof.visible = !bunker.occupant;
            model.badge.visible = Boolean(bunker.occupant);
            if (bunker.occupant) model.badge.material = this.badgeMaterial(bunker.occupant.turnsLeft);
            this.cellDescriptions[bunker.row * 8 + bunker.col].push(bunker.occupant ?
                `Occupied bunker, ${bunker.occupant.turnsLeft} rounds left` : 'Empty bunker');
        }
        this.removeMissing(this.bunkers, bunkerKeys);
        const alive = new Set();
        (state.players || []).forEach((player, playerIndex) => {
            (player.peeps || []).forEach((peep, peepIndex) => {
                if (!peep.alive) return;
                const key = peepKey(playerIndex, peepIndex);
                alive.add(key);
                let person = this.people.get(key);
                const target = new THREE.Vector3(peep.col - 3.5, peep.inBunker ? 0.17 : 0.09, peep.row - 3.5);
                if (!person) {
                    person = this.createPerson(playerIndex, peepIndex);
                    person.root.position.copy(target);
                    person.target.copy(target);
                    person.from.copy(target);
                    this.people.set(key, person);
                }
                if (!person.target.equals(target)) {
                    this.positionPerson(person, now);
                    person.from.copy(person.root.position);
                    const dx = target.x - person.from.x;
                    const dz = target.z - person.from.z;
                    if (Math.hypot(dx, dz) > 0.01) person.facing = Math.atan2(dx, dz);
                    person.target.copy(target);
                    person.moveStart = now;
                    person.moving = !this.reducedMotion;
                    if (this.reducedMotion) person.root.position.copy(target);
                }
                person.root.userData.cell = { row: peep.row, col: peep.col };
                person.hasUmbrella = Boolean(peep.hasUmbrella);
                person.inBunker = Boolean(peep.inBunker);
                person.umbrella.visible = person.hasUmbrella && !person.inBunker;
                person.moved.visible = playerIndex === state.currentPlayerIndex &&
                    Boolean(state.peepsMoved?.includes(peepIndex));
                if (splashChanged) {
                    person.body.scale.setScalar(1);
                    person.body.rotation.z = 0;
                    person.umbrella.rotation.z = 0;
                }
                this.cellDescriptions[peep.row * 8 + peep.col].push(
                    `${NAMES[playerIndex]} peep ${peepIndex + 1}${peep.hasUmbrella ? ', umbrella' : ''}` +
                    `${person.moved.visible ? ', already moved' : ''}`
                );
            });
        });
        this.removeMissing(this.people, alive);
        this.cellDescriptions = this.cellDescriptions.map(parts => parts.join('. ') || 'Empty tile');
        if (splashChanged) {
            (state.splashedCells || []).forEach((cell, index) => {
                this.createSplash(cell.row, cell.col, now + Math.min(index * 65, 325));
            });
        }
        if (document.activeElement === this.canvas) this.updateFocus();
        this.updateVisibility();
        this.wake();
    }

    removeMissing(collection, keys) {
        for (const [key, model] of collection) {
            if (!keys.has(key)) {
                model.root.removeFromParent();
                // Model meshes borrow the bounded geometry/material pools, so only
                // their object hierarchy is released here. Pools are disposed once.
                model.root.clear();
                collection.delete(key);
            }
        }
    }

    createSplash(row, col, start) {
        const root = new THREE.Group();
        root.position.set(col - 3.5, 0.10, row - 3.5);
        this.scene.add(root);
        const balloon = new THREE.Group();
        root.add(balloon);
        this.sphere(balloon, 0x85bdcc, [0.17, 0.22, 0.17], [0, 0, 0]);
        this.sphere(balloon, 0xd9eee8, [0.035, 0.055, 0.014], [-0.06, 0.07, 0.143]);
        const knot = this.mesh(balloon,
            this.geometry('knot', () => new THREE.ConeGeometry(0.033, 0.06, 6)),
            this.material(0x679daa), [1, 1, 1], [0, -0.245, 0]);
        knot.rotation.z = Math.PI;
        const spray = new THREE.Group();
        root.add(spray);
        const drops = [];
        for (let i = 0; i < 16; i++) {
            const drop = this.sphere(spray, i % 3 ? 0xa6d2d6 : 0xe0f2e9,
                [0.022, 0.06, 0.022], [0, 0, 0]);
            drop.castShadow = false;
            drops.push(drop);
        }
        const ripple = this.ring(root, 0xbbdedd, 0.42, 0.022, [0, 0.025, 0]);
        const effect = { root, balloon, spray, drops, ripple, row, col, start, height: 0, life: 1050 };
        this.effects.push(effect);
        this.updateEffect(effect, performance.now());
        return effect;
    }

    animateHits(hits, onComplete) {
        const now = performance.now();
        const duration = Math.max(0, 900 + (hits.length - 1) * 120);
        if (!this.disposed) {
            hits.forEach((hit, index) => {
                let effect = this.effects.find(item => item.row === hit.row && item.col === hit.col);
                if (!effect) effect = this.createSplash(hit.row, hit.col, now + index * 120);
                effect.start = now + index * 120;
                effect.height = hit.absorbed ? 1.26 : 0.5;
                effect.life = 900;
                this.hitPoses.set(peepKey(hit.playerIndex, hit.peepIndex), {
                    start: now + index * 120, absorbed: Boolean(hit.absorbed)
                });
            });
            this.wake();
        }
        // Game progression must not depend on a visible canvas, animation frames,
        // reduced-motion settings, or whether a newer render replaces an effect.
        const completion = { timer: null, done: false, finish: null };
        completion.finish = () => {
            if (completion.done) return;
            completion.done = true;
            clearTimeout(completion.timer);
            this.completions.delete(completion);
            onComplete();
        };
        completion.timer = setTimeout(completion.finish, duration);
        this.completions.add(completion);
    }

    updateEffect(effect, now) {
        const elapsed = now - effect.start;
        effect.root.visible = elapsed >= 0 && elapsed <= effect.life;
        if (!effect.root.visible) return;
        const landing = 430;
        effect.balloon.visible = elapsed < landing && !this.reducedMotion;
        const fall = clamp(elapsed / landing, 0, 1);
        effect.balloon.position.y = effect.height + (1 - fall * fall) * 4;
        effect.balloon.rotation.z = Math.sin(fall * 8) * 0.11;
        const splash = clamp((elapsed - landing) / (effect.life - landing), 0, 1);
        effect.spray.visible = elapsed >= landing && !this.reducedMotion;
        effect.ripple.visible = elapsed >= landing;
        effect.ripple.scale.setScalar(this.reducedMotion ? 1 : 0.2 + splash * 0.85);
        effect.ripple.position.y = 0.025;
        for (let i = 0; i < effect.drops.length; i++) {
            const angle = i * TAU / effect.drops.length;
            const speed = 0.3 + cosmetic(i + 82) * 0.23;
            const drop = effect.drops[i];
            drop.position.set(Math.cos(angle) * speed * splash,
                Math.max(0.01, effect.height * (1 - splash) + Math.sin(splash * Math.PI) * (0.3 + speed)),
                Math.sin(angle) * speed * splash);
            drop.scale.set(0.022 * (1 - splash * 0.6), 0.06 * (1 - splash * 0.7), 0.022);
            drop.rotation.z = -angle;
        }
    }

    clearEffects() {
        for (const effect of this.effects) {
            effect.root.removeFromParent();
            effect.root.clear();
        }
        this.effects.length = 0;
    }

    positionPerson(person, now) {
        if (!person.moving) return;
        const progress = this.reducedMotion ? 1 : clamp((now - person.moveStart) / 360, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        person.root.position.lerpVectors(person.from, person.target, eased);
        if (progress >= 1) person.moving = false;
    }

    updatePeople(now, delta) {
        for (const [key, person] of this.people) {
            this.positionPerson(person, now);
            const time = now / 1000;
            const moving = person.moving && !this.reducedMotion;
            const phase = time * (moving ? 15 : 1.6) + person.phase;
            const sway = this.reducedMotion ? 0 : Math.sin(phase);
            person.body.position.y = moving ? Math.abs(sway) * 0.045 : sway * 0.009;
            const difference = Math.atan2(Math.sin(person.facing - person.body.rotation.y),
                Math.cos(person.facing - person.body.rotation.y));
            person.body.rotation.y += difference * (this.reducedMotion ? 1 : Math.min(1, delta * 12));
            person.head.rotation.y = moving || this.reducedMotion ? 0 : Math.sin(time * 0.7 + person.phase) * 0.09;
            person.arms[0].rotation.x = sway * (moving ? 0.55 : 0.035);
            person.arms[1].rotation.x = person.hasUmbrella ? -0.55 : -person.arms[0].rotation.x;
            person.legs[0].rotation.x = moving ? -sway * 0.5 : 0;
            person.legs[1].rotation.x = moving ? sway * 0.5 : 0;
            const pose = this.hitPoses.get(key);
            if (pose) {
                const progress = clamp((now - pose.start - 430) / 470, 0, 1);
                if (pose.absorbed) {
                    person.umbrella.rotation.z = this.reducedMotion ? 0 : progress * 0.9;
                    person.umbrella.visible = person.hasUmbrella && !person.inBunker && progress < 0.95;
                } else if (!this.reducedMotion) {
                    person.body.rotation.z = progress * 0.9;
                    person.body.scale.setScalar(1 - progress * 0.78);
                }
            }
        }
    }

    updateVisibility() {
        if (this.disposed) return;
        const visible = !document.hidden && this.container.isConnected &&
            this.container.getClientRects().length > 0 &&
            getComputedStyle(this.screen).visibility !== 'hidden';
        const wasVisible = this.visible;
        this.visible = visible;
        if (!visible) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
            this.cancelGesture();
        } else {
            if (!wasVisible) {
                this.lastTime = 0;
                this.resize();
            }
            this.wake();
        }
    }

    wake() {
        if (this.disposed || !this.visible || this.frame) return;
        this.frame = requestAnimationFrame(time => this.tick(time));
    }

    tick(now) {
        this.frame = 0;
        if (this.disposed || !this.visible || document.hidden) return;
        const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.1) : 1 / 60;
        this.lastTime = now;
        this.updatePeople(now, delta);
        if (!this.reducedMotion) this.updateRain(now / 1000);
        for (let index = this.effects.length - 1; index >= 0; index--) {
            const effect = this.effects[index];
            if (now - effect.start > effect.life) {
                effect.root.removeFromParent();
                effect.root.clear();
                this.effects.splice(index, 1);
            } else {
                this.updateEffect(effect, now);
            }
        }
        this.renderer.render(this.scene, this.camera);
        if (!this.reducedMotion || this.effects.length ||
            Array.from(this.people.values()).some(person => person.moving)) this.wake();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.cancelGesture();
        this.resizeObserver?.disconnect();
        this.visibilityObserver?.disconnect();
        for (const remove of this.listeners) remove();
        this.clearEffects();
        this.people.clear();
        this.bunkers.clear();
        this.scene.traverse(object => object.shadow?.dispose());
        this.scene.clear();
        for (const geometry of this.geometries.values()) geometry.dispose();
        for (const material of this.materials.values()) material.dispose();
        for (const texture of this.textures.values()) texture.dispose();
        this.geometries.clear();
        this.materials.clear();
        this.textures.clear();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        this.canvas.remove();
        this.status?.remove();
        if (this.originalStyle !== undefined) {
            if (this.originalStyle === null) this.container.removeAttribute('style');
            else this.container.setAttribute('style', this.originalStyle);
        }
        // Pending completion timers intentionally survive disposal so game state
        // advances once at the original deadline, even if the renderer is replaced.
    }
};
