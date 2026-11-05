import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderState, Task, VEvent } from '@voragent/shared';
import { ForceSimulation } from './forceSimulation';
import { extractGraphData } from './graphModel';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { GraphToolbar } from './GraphToolbar';
import { DEFAULT_GRAPH_FILTER, type GraphFilterState, type GraphNode, NODE_COLORS } from './types';

interface GraphCanvasProps {
  tasks: Task[];
  providers: ProviderState[];
  events: Map<string, VEvent[]>;
  onSelectTask?: (id: string) => void;
  onSelectNode?: (node: GraphNode | null) => void;
}

export function GraphCanvas({
  tasks,
  providers,
  events,
  onSelectTask,
  onSelectNode,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Bộ lọc
  const [filter, setFilter] = useState<GraphFilterState>(DEFAULT_GRAPH_FILTER);

  // Trích xuất dữ liệu thô
  const rawData = useMemo(() => {
    return extractGraphData(tasks, providers, events);
  }, [tasks, providers, events]);

  // Lọc dữ liệu hiển thị theo filter
  const visibleData = useMemo(() => {
    const query = filter.searchQuery.trim().toLowerCase();

    const nodes = rawData.nodes.filter((node) => {
      if (node.type === 'provider' && !filter.showProviders) return false;
      if (node.type === 'task' && !filter.showTasks) return false;
      if (node.type === 'file' && !filter.showFiles) return false;
      if (node.type === 'handoff' && !filter.showHandoffs) return false;
      return true;
    });

    const nodeIds = new Set(nodes.map((n) => n.id));

    const edges = rawData.edges.filter((edge) => {
      if (edge.type === 'handoff_to' && !filter.showHandoffs) return false;
      return nodeIds.has(edge.source) && nodeIds.has(edge.target);
    });

    return { nodes, edges, query };
  }, [rawData, filter]);

  // Bộ mô phỏng lực vật lý
  const simRef = useRef<ForceSimulation>(new ForceSimulation(visibleData.nodes, visibleData.edges));
  const [isPhysicsActive, setIsPhysicsActive] = useState(true);

  // Cập nhật dữ liệu cho simulation khi dữ liệu lọc thay đổi
  useEffect(() => {
    simRef.current.updateData(visibleData.nodes, visibleData.edges);
  }, [visibleData]);

  // Tọa độ camera (Pan & Zoom)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Trạng thái tương tác chuột
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const draggingNodeRef = useRef<GraphNode | null>(null);
  const isPanningRef = useRef(false);
  const startPanRef = useRef({ x: 0, y: 0 });

  // Tìm node dưới con trỏ chuột
  const getNodeAtPoint = useCallback((screenX: number, screenY: number): GraphNode | null => {
    const { x: panX, y: panY, scale } = transformRef.current;
    const worldX = (screenX - panX) / scale;
    const worldY = (screenY - panY) / scale;

    const nodes = simRef.current.getNodes();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!n) continue;
      const dx = worldX - n.x;
      const dy = worldY - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius) {
        return n;
      }
    }
    return null;
  }, []);

  // Căn toàn cảnh (Fit to screen)
  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const nodes = simRef.current.getNodes();
    if (nodes.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      minX = Math.min(minX, n.x - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      minY = Math.min(minY, n.y - n.radius);
      maxY = Math.max(maxY, n.y + n.radius);
    });

    const w = canvas.width;
    const h = canvas.height;
    const graphW = maxX - minX + 160;
    const graphH = maxY - minY + 160;

    const scale = Math.min(1.8, Math.max(0.3, Math.min(w / graphW, h / graphH)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setTransform({
      scale,
      x: w / 2 - centerX * scale,
      y: h / 2 - centerY * scale,
    });
  }, []);

  // Khởi tạo căn giữa lần đầu
  useEffect(() => {
    const timer = setTimeout(fitView, 350);
    return () => clearTimeout(timer);
  }, [fitView]);

  // Vòng lặp Render Canvas chính (60fps)
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Kích thước thực theo màn hình retina
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      // Bước tính toán vật lý
      if (isPhysicsActive) {
        simRef.current.tick();
      }

      const { x: panX, y: panY, scale } = transformRef.current;
      const nodes = simRef.current.getNodes();
      const edges = simRef.current.getEdges();
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // 1. Nền ấm Warm Tech (#FAF8F5)
      ctx.fillStyle = '#FAF8F5';
      ctx.fillRect(0, 0, width, height);

      // 2. Lưới ma trận chấm tròn ấm áp (Dot Matrix Pattern)
      ctx.save();
      ctx.fillStyle = '#E6DFD5';
      const dotSpacing = 28 * scale;
      const startX = (panX % dotSpacing + dotSpacing) % dotSpacing;
      const startY = (panY % dotSpacing + dotSpacing) % dotSpacing;
      const dotRadius = Math.max(0.8, 1.2 * scale);

      for (let x = startX; x < width; x += dotSpacing) {
        for (let y = startY; y < height; y += dotSpacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // Áp dụng ma trận biến đổi camera (Pan & Zoom)
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(scale, scale);

      // Xác định tập các nút liên quan đến nút đang được chọn hoặc hover
      const activeId = hoveredNodeId || selectedNodeId;
      const connectedEdges = new Set<string>();
      const connectedNodes = new Set<string>();
      if (activeId) {
        connectedNodes.add(activeId);
        edges.forEach((e) => {
          if (e.source === activeId || e.target === activeId) {
            connectedEdges.add(e.id);
            connectedNodes.add(e.source);
            connectedNodes.add(e.target);
          }
        });
      }

      // 3. Vẽ các Cạnh liên kết (Edges)
      edges.forEach((edge) => {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) return;

        const isHighlighted = connectedEdges.has(edge.id);
        const isDimmed = activeId && !isHighlighted;

        ctx.save();
        ctx.globalAlpha = isDimmed ? 0.12 : isHighlighted ? 1.0 : 0.65;
        ctx.strokeStyle = isHighlighted ? '#1E293B' : edge.color;
        ctx.lineWidth = isHighlighted ? 2.5 : 1.5;

        if (edge.dashed) {
          ctx.setLineDash([5, 4]);
        }

        // Vẽ đường nối
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();

        // Vẽ mũi tên ở phía đích
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 10) {
          const arrowLen = 9;
          const arrowAngle = 0.4;
          const targetDist = t.radius + 2;
          const ax = t.x - (dx / dist) * targetDist;
          const ay = t.y - (dy / dist) * targetDist;
          const lineAngle = Math.atan2(dy, dx);

          ctx.fillStyle = isHighlighted ? '#1E293B' : edge.color;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(
            ax - arrowLen * Math.cos(lineAngle - arrowAngle),
            ay - arrowLen * Math.sin(lineAngle - arrowAngle)
          );
          ctx.lineTo(
            ax - arrowLen * Math.cos(lineAngle + arrowAngle),
            ay - arrowLen * Math.sin(lineAngle + arrowAngle)
          );
          ctx.closePath();
          ctx.fill();
        }

        // Nhãn quan hệ (vẽ nếu được zoom vào đủ gần)
        if (scale > 0.65 && edge.label) {
          const midX = (s.x + t.x) / 2;
          const midY = (s.y + t.y) / 2;
          ctx.font = '10px monospace';
          const textW = ctx.measureText(edge.label).width;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(midX - textW / 2 - 3, midY - 6, textW + 6, 12);
          ctx.fillStyle = isHighlighted ? '#1E293B' : '#64748B';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(edge.label, midX, midY);
        }

        ctx.restore();
      });

      // 4. Vẽ các Nút (Nodes)
      nodes.forEach((node) => {
        const isSelected = selectedNodeId === node.id;
        const isHovered = hoveredNodeId === node.id;
        const isConnected = connectedNodes.has(node.id);
        const isDimmed = activeId && !isConnected;

        // Kiểm tra khớp từ khóa tìm kiếm
        const query = visibleData.query;
        const isSearchMatch = query && (
          node.label.toLowerCase().includes(query) ||
          (node.subLabel && node.subLabel.toLowerCase().includes(query))
        );

        ctx.save();
        ctx.globalAlpha = isDimmed ? 0.2 : 1.0;

        // Hào quang tìm kiếm (Search Glow Ring)
        if (isSearchMatch) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Hào quang khi chọn hoặc hover
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? 'rgba(37, 99, 235, 0.2)' : 'rgba(0, 0, 0, 0.08)';
          ctx.fill();
        }

        // Thân nút hình tròn có đổ bóng nhẹ
        ctx.shadowColor = 'rgba(43, 38, 34, 0.12)';
        ctx.shadowBlur = isHovered ? 12 : 6;
        ctx.shadowOffsetY = 2;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        const palette = NODE_COLORS[node.type];
        ctx.fillStyle = palette.bg;
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = isSelected ? '#1E293B' : node.color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();

        // Biểu tượng icon ở tâm
        ctx.font = `${Math.round(node.radius * 0.9)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.icon, node.x, node.y - (node.type === 'task' ? 2 : 0));

        // Nhãn tên nút (Label)
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.fillStyle = '#1E293B';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, node.x, node.y + node.radius + 6);

        // Nhãn phụ (SubLabel)
        if (node.subLabel && scale > 0.55) {
          ctx.font = '500 10px monospace';
          ctx.fillStyle = '#64748B';
          ctx.fillText(node.subLabel, node.x, node.y + node.radius + 20);
        }

        ctx.restore();
      });

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [visibleData, isPhysicsActive, hoveredNodeId, selectedNodeId]);

  // ================= XỬ LÝ SỰ KIỆN CHUỘT (INTERACTIONS) =================
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const clickedNode = getNodeAtPoint(screenX, screenY);
    if (clickedNode) {
      draggingNodeRef.current = clickedNode;
      setSelectedNodeId(clickedNode.id);
      onSelectNode?.(clickedNode);
    } else {
      isPanningRef.current = true;
      startPanRef.current = {
        x: screenX - transformRef.current.x,
        y: screenY - transformRef.current.y,
      };
      setSelectedNodeId(null);
      onSelectNode?.(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (draggingNodeRef.current) {
      // Kéo thả node
      const { x: panX, y: panY, scale } = transformRef.current;
      draggingNodeRef.current.x = (screenX - panX) / scale;
      draggingNodeRef.current.y = (screenY - panY) / scale;
      draggingNodeRef.current.vx = 0;
      draggingNodeRef.current.vy = 0;
      simRef.current.isStable = false; // Đánh thức physics
    } else if (isPanningRef.current) {
      // Kéo rê toàn cảnh (Pan)
      setTransform((prev) => ({
        ...prev,
        x: screenX - startPanRef.current.x,
        y: screenY - startPanRef.current.y,
      }));
    } else {
      // Hover node
      const node = getNodeAtPoint(screenX, screenY);
      setHoveredNodeId(node ? node.id : null);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? 'pointer' : 'default';
      }
    }
  };

  const handleMouseUp = () => {
    draggingNodeRef.current = null;
    isPanningRef.current = false;
  };

  // Cuộn chuột để Thu phóng (Zoom)
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setTransform((prev) => {
      const nextScale = Math.min(3.0, Math.max(0.2, prev.scale * zoomFactor));
      const nextX = mouseX - (mouseX - prev.x) * (nextScale / prev.scale);
      const nextY = mouseY - (mouseY - prev.y) * (nextScale / prev.scale);
      return { scale: nextScale, x: nextX, y: nextY };
    });
  };

  // Double click vào task node để mở chi tiết task
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const node = getNodeAtPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (node && node.type === 'task' && node.data.task && onSelectTask) {
      onSelectTask(node.data.task.id);
    }
  };

  const selectedNode = visibleData.nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 170px)', overflow: 'hidden' }}>
      <GraphToolbar
        filter={filter}
        onFilterChange={setFilter}
        onZoomIn={() => setTransform((p) => ({ ...p, scale: Math.min(3.0, p.scale * 1.25) }))}
        onZoomOut={() => setTransform((p) => ({ ...p, scale: Math.max(0.2, p.scale * 0.8) }))}
        onFitView={fitView}
        onTogglePhysics={() => setIsPhysicsActive(!isPhysicsActive)}
        isPhysicsActive={isPhysicsActive}
        nodeCount={visibleData.nodes.length}
        edgeCount={visibleData.edges.length}
      />

      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      <NodeDetailDrawer
        node={selectedNode}
        edges={visibleData.edges}
        nodes={visibleData.nodes}
        onClose={() => {
          setSelectedNodeId(null);
          onSelectNode?.(null);
        }}
        onSelectTask={onSelectTask}
      />
    </div>
  );
}
