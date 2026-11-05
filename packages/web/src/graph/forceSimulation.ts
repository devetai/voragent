import type { GraphEdge, GraphNode } from './types';

export interface ForceSimulationOptions {
  repulsion: number;     // Hằng số lực đẩy Coulomb (mặc định 6000)
  springLength: number;  // Chiều dài tự nhiên của lò xo (mặc định 140)
  springStrength: number;// Độ cứng lò xo (mặc định 0.045)
  gravity: number;       // Lực hút về tâm (mặc định 0.02)
  damping: number;       // Hệ số ma sát hãm (mặc định 0.82)
  minEnergy: number;     // Ngưỡng năng lượng dừng tính toán (mặc định 0.05)
}

const DEFAULT_OPTIONS: ForceSimulationOptions = {
  repulsion: 6500,
  springLength: 140,
  springStrength: 0.04,
  gravity: 0.025,
  damping: 0.85,
  minEnergy: 0.08,
};

export class ForceSimulation {
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private options: ForceSimulationOptions;
  public isStable = false;

  constructor(nodes: GraphNode[], edges: GraphEdge[], opts: Partial<ForceSimulationOptions> = {}) {
    this.nodes = nodes;
    this.edges = edges;
    this.options = { ...DEFAULT_OPTIONS, ...opts };
  }

  public updateData(nodes: GraphNode[], edges: GraphEdge[]): void {
    // Giữ nguyên tọa độ cũ của các node đã tồn tại để tránh giật hình
    const oldMap = new Map(this.nodes.map((n) => [n.id, n]));
    this.nodes = nodes.map((n) => {
      const old = oldMap.get(n.id);
      if (old) {
        return { ...n, x: old.x, y: old.y, vx: old.vx, vy: old.vy };
      }
      return n;
    });
    this.edges = edges;
    this.isStable = false;
  }

  public tick(): boolean {
    if (this.isStable || this.nodes.length === 0) return false;

    const { repulsion, springLength, springStrength, gravity, damping, minEnergy } = this.options;
    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));

    // 1. Tính Lực Đẩy Coulomb giữa các cặp nút
    for (let i = 0; i < this.nodes.length; i++) {
      const na = this.nodes[i];
      if (!na) continue;
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nb = this.nodes[j];
        if (!nb) continue;

        const dx = nb.x - na.x;
        const dy = nb.y - na.y;
        const distSq = dx * dx + dy * dy;
        const minDist = na.radius + nb.radius + 15;
        const effectiveDist = Math.max(minDist, Math.sqrt(distSq));

        const force = (repulsion * (na.radius + nb.radius)) / (effectiveDist * effectiveDist * 2);
        const fx = (dx / effectiveDist) * force;
        const fy = (dy / effectiveDist) * force;

        na.vx -= fx;
        na.vy -= fy;
        nb.vx += fx;
        nb.vy += fy;
      }
    }

    // 2. Tính Lực Hút Lò Xo dọc theo các Cạnh liên kết
    for (const edge of this.edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const delta = dist - springLength;

      const force = delta * springStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    // 3. Tính Lực Hướng Tâm kéo về (0, 0) và Cập Nhật Tọa Độ
    let totalKineticEnergy = 0;

    for (const node of this.nodes) {
      // Trọng lực kéo về tâm
      node.vx -= node.x * gravity;
      node.vy -= node.y * gravity;

      // Áp dụng ma sát hãm
      node.vx *= damping;
      node.vy *= damping;

      // Giới hạn vận tốc tối đa để không nhảy vọt
      const maxSpeed = 24;
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > maxSpeed) {
        node.vx = (node.vx / speed) * maxSpeed;
        node.vy = (node.vy / speed) * maxSpeed;
      }

      node.x += node.vx;
      node.y += node.vy;

      totalKineticEnergy += node.vx * node.vx + node.vy * node.vy;
    }

    // Kiểm tra ngưỡng dừng
    const avgEnergy = totalKineticEnergy / this.nodes.length;
    if (avgEnergy < minEnergy) {
      this.isStable = true;
      return false; // Đã ổn định, dừng render loop vật lý
    }

    return true; // Vẫn đang chuyển động
  }

  public getNodes(): GraphNode[] {
    return this.nodes;
  }

  public getEdges(): GraphEdge[] {
    return this.edges;
  }
}
