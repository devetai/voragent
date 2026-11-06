import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const CAT_QUOTES = [
  'Purr purr~ ❤️ Chúc bạn build code một phát ăn ngay!',
  'Nhớ đứng dậy uống chút nước và vươn vai nhé! 🐾',
  'Đừng quên commit trước khi tắt máy nha meow~',
  'Code mượt như lông mèo, không còn con bug nào! ✨',
  'Ngủ một giấc là bug tự biến mất đấy meow~ 💤',
];

const ROOMBA_QUOTES = [
  '🧹 Beep boop! Đã dọn sạch 2.4GB node_modules rác!',
  '🧹 Vút vút! Sàn nhà bóng loáng, sạch bóng syntax error!',
  '🔋 Pin 99%! Sẵn sàng phục vụ các kỹ sư rắn!',
  '⚡ Quét xong bộ nhớ đệm, RAM đã nhẹ như mây!',
];

/** Chú mèo lười Paws sưởi nắng trên bệ cửa sổ */
export function OfficeCat() {
  const groupRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Group>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [petMessage, setPetMessage] = useState<string | null>(null);
  const [hearts, setHearts] = useState<{ id: number; offset: number }[]>([]);
  const petTimeout = useRef<any>(null);

  const handlePet = (e: any) => {
    e.stopPropagation();
    const quote = CAT_QUOTES[Math.floor(Math.random() * CAT_QUOTES.length)] ?? CAT_QUOTES[0]!;
    setPetMessage(quote);
    setHearts((prev) => [...prev, { id: Date.now(), offset: (Math.random() - 0.5) * 0.4 }]);

    if (petTimeout.current) clearTimeout(petTimeout.current);
    petTimeout.current = setTimeout(() => {
      setPetMessage(null);
    }, 4500);
  };

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (tailRef.current) {
      tailRef.current.rotation.z = Math.sin(t * 2.5) * 0.25 + 0.3;
    }
    if (headRef.current) {
      headRef.current.rotation.y = Math.sin(t * 1.2) * 0.1;
      headRef.current.position.y = 0.28 + Math.sin(t * 2.0) * 0.015;
    }
    if (groupRef.current) {
      const breath = Math.sin(t * 1.8) * 0.015;
      groupRef.current.scale.set(1 + breath, 1 + breath * 1.2, 1 + breath);
    }
  });

  return (
    <group
      ref={groupRef}
      position={[-12.2, 1.9, 0]}
      rotation={[0, Math.PI / 2, 0]}
      onClick={handlePet}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Thảm nhỏ cho mèo nằm */}
      <mesh receiveShadow position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.55, 0.6, 0.04, 24]} />
        <meshStandardMaterial color="#FDE68A" roughness={0.9} />
      </mesh>

      {/* Thân mèo cuộn tròn mướp vàng cam */}
      <mesh castShadow position={[0, 0.16, 0]} scale={[1.2, 0.8, 1.0]}>
        <sphereGeometry args={[0.26, 20, 16]} />
        <meshStandardMaterial color={isHovered ? '#F59E0B' : '#EA580C'} roughness={0.7} />
      </mesh>

      {/* Đầu mèo */}
      <group ref={headRef} position={[0.22, 0.28, 0.08]}>
        <mesh castShadow>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshStandardMaterial color="#EA580C" roughness={0.7} />
        </mesh>
        {/* Tai trái & Tai phải */}
        <mesh position={[-0.08, 0.14, -0.02]} rotation={[0, 0, 0.3]}>
          <coneGeometry args={[0.06, 0.1, 8]} />
          <meshStandardMaterial color="#F97316" />
        </mesh>
        <mesh position={[0.08, 0.14, -0.02]} rotation={[0, 0, -0.3]}>
          <coneGeometry args={[0.06, 0.1, 8]} />
          <meshStandardMaterial color="#F97316" />
        </mesh>
        {/* Mũi hồng xinh */}
        <mesh position={[0, 0.01, 0.15]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshStandardMaterial color="#FDA4AF" />
        </mesh>
      </group>

      {/* Đuôi mèo cong vắt */}
      <mesh ref={tailRef} position={[-0.26, 0.14, 0]} rotation={[0, 0, 0.3]}>
        <cylinderGeometry args={[0.04, 0.025, 0.32, 12]} />
        <meshStandardMaterial color="#EA580C" />
      </mesh>

      {/* Trái tim nổi khi được vuốt ve */}
      {hearts.map((h) => (
        <Html key={h.id} zIndexRange={[5, 0]} position={[h.offset, 0.8, 0]} center pointerEvents="none">
          <div style={{ fontSize: '20px', animation: 'floatUp 1.8s ease-out forwards', userSelect: 'none' }}>
            ❤️
          </div>
        </Html>
      ))}

      {/* Bong bóng thoại khi vuốt ve */}
      {petMessage && (
        <Html zIndexRange={[5, 0]} position={[0, 0.85, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(6px)',
              padding: '6px 12px',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              border: '1px solid #FDBA74',
              color: '#9A3412',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            🐱 Paws: {petMessage}
          </div>
        </Html>
      )}

      {/* Hint khi hover */}
      {isHovered && !petMessage && (
        <Html zIndexRange={[5, 0]} position={[0, 0.65, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.85)',
              color: '#FFFFFF',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            🐾 Nhấp để vuốt ve mèo Paws
          </div>
        </Html>
      )}
    </group>
  );
}

/** Robot hút bụi Roomba BeepBoop tự hành dọn dẹp sàn nhà */
export function RoombaBot() {
  const roombaRef = useRef<THREE.Group>(null);
  const brushLeftRef = useRef<THREE.Mesh>(null);
  const brushRightRef = useRef<THREE.Mesh>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [roombaMessage, setRoombaMessage] = useState<string | null>(null);
  const spinTimer = useRef<any>(null);

  const handleClick = (e: any) => {
    e.stopPropagation();
    setIsSpinning(true);
    const quote = ROOMBA_QUOTES[Math.floor(Math.random() * ROOMBA_QUOTES.length)] ?? ROOMBA_QUOTES[0]!;
    setRoombaMessage(quote);

    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => {
      setIsSpinning(false);
      setRoombaMessage(null);
    }, 4000);
  };

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!roombaRef.current) return;

    if (brushLeftRef.current) brushLeftRef.current.rotation.y = t * 15;
    if (brushRightRef.current) brushRightRef.current.rotation.y = -t * 15;

    if (isSpinning) {
      roombaRef.current.rotation.y += 0.25;
      roombaRef.current.position.y = 0.08 + Math.abs(Math.sin(t * 12)) * 0.08;
    } else {
      // Lộ trình tuần tra hình chữ nhật dọc hành lang giữa các bàn
      const loop = (t * 0.4) % 4; // 4 pha: 0..1, 1..2, 2..3, 3..4
      let x = 0;
      let z = 2.4;
      let rot = 0;

      if (loop < 1) {
        // Đi từ trái sang phải
        x = -4 + loop * 8;
        z = 2.4;
        rot = Math.PI / 2;
      } else if (loop < 2) {
        // Rẽ xuống dưới
        const p = loop - 1;
        x = 4;
        z = 2.4 + p * 2.2;
        rot = 0;
      } else if (loop < 3) {
        // Đi từ phải qua trái
        const p = loop - 2;
        x = 4 - p * 8;
        z = 4.6;
        rot = -Math.PI / 2;
      } else {
        // Rẽ lên trên về điểm ban đầu
        const p = loop - 3;
        x = -4;
        z = 4.6 - p * 2.2;
        rot = Math.PI;
      }

      roombaRef.current.position.set(x, 0.08, z);
      roombaRef.current.rotation.y = rot;
    }
  });

  return (
    <group
      ref={roombaRef}
      position={[0, 0.08, 2.4]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Đĩa tròn thân máy Roomba trắng ngà */}
      <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.38, 0.4, 0.12, 32]} />
        <meshStandardMaterial color={isHovered ? '#E2E8F0' : '#FFFFFF'} roughness={0.3} metalness={0.1} />
      </mesh>

      {/* Vòng cản cao su đen chống va đập */}
      <mesh position={[0, 0.04, 0.1]}>
        <cylinderGeometry args={[0.405, 0.405, 0.05, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#1E293B" />
      </mesh>

      {/* Cảm biến mắt hồng ngoại / LiDAR trên nóc */}
      <mesh position={[0, 0.14, -0.06]}>
        <cylinderGeometry args={[0.09, 0.1, 0.05, 16]} />
        <meshStandardMaterial color="#0F172A" />
      </mesh>

      {/* Đèn LED thông thái chớp nháy */}
      <mesh position={[0, 0.13, 0.18]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshBasicMaterial color={isSpinning ? '#F59E0B' : '#10B981'} />
      </mesh>

      {/* 2 Chổi quét xoay tròn bên hông */}
      <mesh ref={brushLeftRef} position={[-0.32, 0.02, 0.2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.015, 8]} />
        <meshStandardMaterial color="#64748B" />
      </mesh>
      <mesh ref={brushRightRef} position={[0.32, 0.02, 0.2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.015, 8]} />
        <meshStandardMaterial color="#64748B" />
      </mesh>

      {/* Bong bóng thoại Roomba */}
      {roombaMessage && (
        <Html zIndexRange={[5, 0]} position={[0, 0.6, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(6px)',
              padding: '6px 12px',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              border: '1px solid #94A3B8',
              color: '#1E293B',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            🤖 BeepBoop: {roombaMessage}
          </div>
        </Html>
      )}

      {/* Hint khi hover */}
      {isHovered && !roombaMessage && (
        <Html zIndexRange={[5, 0]} position={[0, 0.45, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.85)',
              color: '#FFFFFF',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            🧹 Nhấp để kích hoạt Roomba dọn phòng
          </div>
        </Html>
      )}
    </group>
  );
}

/** Máy pha cà phê tương tác tại quầy bar */
export function InteractiveCoffeeMachine({ position }: { position: [number, number, number] }) {
  const [isBrewing, setIsBrewing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [steam, setSteam] = useState(false);
  const brewTimer = useRef<any>(null);

  const handleBrew = (e: any) => {
    e.stopPropagation();
    setIsBrewing(true);
    setSteam(true);

    if (brewTimer.current) clearTimeout(brewTimer.current);
    brewTimer.current = setTimeout(() => {
      setIsBrewing(false);
      setSteam(false);
    }, 3800);
  };

  return (
    <group
      position={position}
      onClick={handleBrew}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Khối thân máy cà phê cao cấp */}
      <mesh castShadow position={[0, 0.35, 0]}>
        <boxGeometry args={[0.7, 0.7, 0.5]} />
        <meshStandardMaterial color={isHovered ? '#334155' : '#1E293B'} metalness={0.4} roughness={0.3} />
      </mesh>

      {/* Khay rót kim loại sáng */}
      <mesh position={[0, 0.1, 0.15]}>
        <boxGeometry args={[0.5, 0.04, 0.2]} />
        <meshStandardMaterial color="#94A3B8" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Vòi rót kép */}
      <mesh position={[0, 0.4, 0.15]}>
        <cylinderGeometry args={[0.04, 0.04, 0.12]} />
        <meshStandardMaterial color="#CBD5E1" metalness={0.9} />
      </mesh>

      {/* Đèn báo trạng thái pha */}
      <mesh position={[0.2, 0.6, 0.26]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshBasicMaterial color={isBrewing ? '#F59E0B' : '#10B981'} />
      </mesh>

      {/* Ly cà phê đang được rót */}
      <mesh position={[0, 0.2, 0.15]}>
        <cylinderGeometry args={[0.065, 0.05, 0.14, 16]} />
        <meshStandardMaterial color="#F8FAFC" />
      </mesh>

      {/* Hơi khói bốc lên khi pha */}
      {steam && (
        <Html zIndexRange={[5, 0]} position={[0, 0.85, 0.15]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(6px)',
              padding: '6px 12px',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              border: '1px solid #FCD34D',
              color: '#B45309',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            ☕ Xì xì~ Đã pha 1 ly Espresso nóng hổi! Tiếp sức 200% năng lượng!
          </div>
        </Html>
      )}

      {/* Hint khi hover */}
      {isHovered && !isBrewing && (
        <Html zIndexRange={[5, 0]} position={[0, 0.75, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.85)',
              color: '#FFFFFF',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            ☕ Nhấp để pha cà phê tiếp sức
          </div>
        </Html>
      )}
    </group>
  );
}

/** Chậu cây xanh tương tác bên cửa sổ */
export function InteractivePlant({ position }: { position: [number, number, number] }) {
  const [bounce, setBounce] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isWatered, setIsWatered] = useState(false);
  const plantRef = useRef<THREE.Group>(null);
  const waterTimer = useRef<any>(null);

  const handleWater = (e: any) => {
    e.stopPropagation();
    setBounce(1);
    setIsWatered(true);

    if (waterTimer.current) clearTimeout(waterTimer.current);
    waterTimer.current = setTimeout(() => {
      setIsWatered(false);
    }, 3500);
  };

  useFrame((_, delta) => {
    if (bounce > 0) {
      setBounce((b) => Math.max(0, b - delta * 2.5));
      if (plantRef.current) {
        plantRef.current.rotation.z = Math.sin(bounce * 15) * 0.15;
      }
    } else if (plantRef.current) {
      plantRef.current.rotation.z = 0;
    }
  });

  return (
    <group
      ref={plantRef}
      position={position}
      onClick={handleWater}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Chậu sứ ấm áp */}
      <mesh castShadow position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.45, 0.35, 1.0, 16]} />
        <meshStandardMaterial color={isHovered ? '#FDE68A' : '#EFE7DA'} />
      </mesh>

      {/* Tán cây xanh mướt */}
      <mesh castShadow position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.85, 16, 16]} />
        <meshStandardMaterial color="#2E9E5B" roughness={0.7} />
      </mesh>

      {/* Bông hoa nhỏ nở khi được tưới */}
      {isWatered && (
        <mesh position={[0.2, 2.1, 0.2]}>
          <sphereGeometry args={[0.14, 12, 12]} />
          <meshStandardMaterial color="#F43F5E" />
        </mesh>
      )}

      {/* Bong bóng khi tưới cây */}
      {isWatered && (
        <Html zIndexRange={[5, 0]} position={[0, 2.4, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(6px)',
              padding: '6px 12px',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              border: '1px solid #86EFAC',
              color: '#166534',
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            🌱 Cây đã được tưới nước tươi mát! Nở một đóa hoa xinh 🌸
          </div>
        </Html>
      )}

      {/* Hint khi hover */}
      {isHovered && !isWatered && (
        <Html zIndexRange={[5, 0]} position={[0, 1.8, 0]} center pointerEvents="none">
          <div
            style={{
              backgroundColor: 'rgba(30, 41, 59, 0.85)',
              color: '#FFFFFF',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            💧 Nhấp để tưới cây
          </div>
        </Html>
      )}
    </group>
  );
}

/** Đèn bàn làm việc tương tác có thể bật/tắt chóa sáng */
export function InteractiveDeskLamp({ position }: { position: [number, number, number] }) {
  const [isOn, setIsOn] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        setIsOn(!isOn);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Đế đèn */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.04]} />
        <meshStandardMaterial color="#2B2622" />
      </mesh>
      {/* Thân đèn cong */}
      <mesh position={[0, 0.25, 0]} rotation={[0, 0, 0.25]}>
        <boxGeometry args={[0.03, 0.5, 0.03]} />
        <meshStandardMaterial color="#2B2622" />
      </mesh>
      {/* Chóa đèn chụp nón */}
      <mesh position={[0.1, 0.52, 0]} rotation={[0, 0, -0.3]}>
        <coneGeometry args={[0.12, 0.18, 16]} />
        <meshStandardMaterial color={isHovered ? '#F97316' : '#D97757'} />
      </mesh>

      {/* Ánh sáng ấm áp rọi xuống mặt bàn khi bật */}
      {isOn && (
        <pointLight position={[0.1, 0.42, 0]} color="#FEF08A" intensity={1.5} distance={3.5} />
      )}
    </group>
  );
}
