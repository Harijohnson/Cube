"use client"

import React, { useRef, useMemo, useState, useEffect, useCallback } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Environment, ContactShadows, BakeShadows, RoundedBox } from "@react-three/drei"
import * as THREE from "three"

// Enhanced easing function for smoother animations
const easeInOutCubic = (t: number) => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// Pre-normalized rotation axes
const ROTATION_AXES = {
  TOP: new THREE.Vector3(0, 1, 0).normalize(),
  RIGHT: new THREE.Vector3(1, 0, 0).normalize(),
  BOTTOM: new THREE.Vector3(0, -1, 0).normalize(),
  LEFT: new THREE.Vector3(-1, 0, 0).normalize(),
  FRONT: new THREE.Vector3(0, 0, 1).normalize(),
  BACK: new THREE.Vector3(0, 0, -1).normalize(),
}

// Rotation directions for each face
const ROTATION_DIRECTIONS = {
  RIGHT: 1, LEFT: -1, TOP: 1, BOTTOM: -1, FRONT: 1, BACK: -1,
}

// Layer indices for each face
const LAYER_INDICES = {
  RIGHT: { axis: "x", value: 1 },
  LEFT: { axis: "x", value: -1 },
  TOP: { axis: "y", value: 1 },
  BOTTOM: { axis: "y", value: -1 },
  FRONT: { axis: "z", value: 1 },
  BACK: { axis: "z", value: -1 },
}

// Face rotation sequence
const ROTATION_SEQUENCE = ["RIGHT", "FRONT", "BACK", "LEFT", "TOP", "BOTTOM"]

// Constants for cube dimensions
const CUBE_SIZE = 1.0
const CUBE_GAP = 0.00001
const EPSILON = 0.000000001 // Precision threshold

// Generate target positions for a solved cube
function getTargetPositions() {
  const positions = []
  
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue
        positions.push({ x, y, z })
      }
    }
  }
  return positions
}

// Main Cube component that handles the Rubik's Cube logic and animation
function Cube() {
  // Reference to the entire cube group
  const groupRef = useRef<THREE.Group>(null)
  
  // References to individual cubies for direct manipulation
  const cubieRefs = useRef<(THREE.Group | null)[]>([])
  
  // Type definition for cubie position data
  type CubiePosition = {
    position: THREE.Vector3      // World position
    indices: THREE.Vector3       // Grid indices (-1, 0, 1)
    quaternion: THREE.Quaternion // Orientation
    type: string                 // Corner, edge, or center
  }
  
  // Current positions of all cubies
  const [cubiePositions, setCubiePositions] = useState<CubiePosition[]>([])
  
  // State to track rotation animation
  const [rotationState, setRotationState] = useState<{
    isRotating: boolean
    currentFace: string | null
    progress: number
    sequenceIndex: number
    inSequencePause: boolean
    inRotationPause: boolean
  }>({
    isRotating: false,
    currentFace: null,
    progress: 0,
    sequenceIndex: 0,
    inSequencePause: false,
    inRotationPause: false,
  })

  // Generate initial positions for all 26 cubies
  const initialCubiePositions = useMemo(() => {
    const positions: CubiePosition[] = []
    const targetPositions = getTargetPositions()
    
    targetPositions.forEach(pos => {
      const { x, y, z } = pos
      
      const posX = x * (CUBE_SIZE + CUBE_GAP)
      const posY = y * (CUBE_SIZE + CUBE_GAP)
      const posZ = z * (CUBE_SIZE + CUBE_GAP)
      
      const zeroCount = [x, y, z].filter(coord => coord === 0).length
      let type = "corner"
      if (zeroCount === 1) type = "edge"
      else if (zeroCount === 2) type = "center"
      
      positions.push({
        position: new THREE.Vector3(posX, posY, posZ),
        indices: new THREE.Vector3(x, y, z),
        quaternion: new THREE.Quaternion(),
        type,
      })
    })
    
    return positions
  }, [])

  // Initialize cubie positions
  useEffect(() => {
    setCubiePositions(initialCubiePositions)
    
    cubieRefs.current = Array(initialCubiePositions.length)
      .fill(null) as (THREE.Group | null)[]
    
    setTimeout(() => {
      setRotationState((prev) => ({
        ...prev,
        isRotating: true,
        currentFace: ROTATION_SEQUENCE[0],
      }))
    }, 1000)
  }, [initialCubiePositions])

  // Get the world center point of a face
  const getFaceCenter = useCallback((face: string): THREE.Vector3 => {
    const { axis, value } = LAYER_INDICES[face as keyof typeof LAYER_INDICES]
    const center = new THREE.Vector3(0, 0, 0)
    
    if (axis === "x") center.setX(value * (CUBE_SIZE + CUBE_GAP))
    if (axis === "y") center.setY(value * (CUBE_SIZE + CUBE_GAP))
    if (axis === "z") center.setZ(value * (CUBE_SIZE + CUBE_GAP))
    
    return center
  }, [])

  // Determine which cubies belong to a specific face
  const getCubiesInLayer = useCallback((face: string): number[] => {
    const { axis, value } = LAYER_INDICES[face as keyof typeof LAYER_INDICES]
    const axisIndex = { x: 0, y: 1, z: 2 }[axis as "x" | "y" | "z"]
    
    return cubiePositions
      .map((cubie, i) => {
        return Math.abs(cubie.indices.getComponent(axisIndex) - value) < EPSILON ? i : -1
      })
      .filter(i => i !== -1)
  }, [cubiePositions])

  // Snap a vector to integer coordinates to prevent floating point drift
  const snapToGrid = useCallback((vec: THREE.Vector3): THREE.Vector3 => {
    const x = Math.abs(vec.x) < EPSILON ? 0 : Math.sign(vec.x) * Math.round(Math.abs(vec.x))
    const y = Math.abs(vec.y) < EPSILON ? 0 : Math.sign(vec.y) * Math.round(Math.abs(vec.y))
    const z = Math.abs(vec.z) < EPSILON ? 0 : Math.sign(vec.z) * Math.round(Math.abs(vec.z))
    
    return new THREE.Vector3(x, y, z)
  }, [])

  // Calculate intermediate positions for layer rotation animation
  const calculateLayerRotation = useCallback((face: string, angle: number) => {
    const cubiesInLayer = getCubiesInLayer(face)
    const axis = ROTATION_AXES[face as keyof typeof ROTATION_AXES]
    const direction = ROTATION_DIRECTIONS[face as keyof typeof ROTATION_DIRECTIONS]
    const centerPoint = getFaceCenter(face)
    
    const rotationQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle * direction)
    
    return cubiePositions.map((cubie, index) => {
      if (!cubiesInLayer.includes(index)) {
        return { ...cubie }
      }
      
      const newPosition = cubie.position.clone()
      const newIndices = cubie.indices.clone()
      const newQuaternion = cubie.quaternion.clone()
      
      newPosition.sub(centerPoint)
      newPosition.applyAxisAngle(axis, angle * direction)
      newPosition.add(centerPoint)
      
      newIndices.applyAxisAngle(axis, angle * direction)
      
      newQuaternion.premultiply(rotationQuat)
      
      return {
        ...cubie,
        position: newPosition,
        indices: newIndices,
        quaternion: newQuaternion
      }
    })
  }, [cubiePositions, getCubiesInLayer, getFaceCenter])

  // Apply a complete 90-degree rotation and snap to grid
  const rotateLayer = useCallback((face: string): CubiePosition[] => {
    const angle = Math.PI / 2 // 90 degrees
    const rotatedPositions = calculateLayerRotation(face, angle)
    
    return rotatedPositions.map(cubie => ({
      ...cubie,
      position: snapToGrid(cubie.position),
      indices: snapToGrid(cubie.indices),
    }))
  }, [calculateLayerRotation, snapToGrid])

  // Start the next rotation in the sequence
  const startNextRotation = useCallback(() => {
    setRotationState((prev) => {
      const newSequenceIndex = (prev.sequenceIndex + 1) % ROTATION_SEQUENCE.length
      
      if (newSequenceIndex === 0 && !prev.inSequencePause) {
        return {
          ...prev,
          inRotationPause: false,
          inSequencePause: true,
        }
      }
      
      return {
        ...prev,
        isRotating: true,
        currentFace: ROTATION_SEQUENCE[newSequenceIndex],
        sequenceIndex: newSequenceIndex,
        progress: 0,
        inRotationPause: false,
        inSequencePause: false,
      }
    })
  }, [])

  // Handle sequence pause
  useEffect(() => {
    if (rotationState.inSequencePause) {
      const timer = setTimeout(() => {
        setRotationState((prev) => ({
          ...prev,
          isRotating: true,
          currentFace: ROTATION_SEQUENCE[0],
          sequenceIndex: 0,
          inSequencePause: false,
        }))
      }, 1000) // 1.5 second pause between sequences
      
      return () => clearTimeout(timer)
    }
  }, [rotationState.inSequencePause])

  // Handle cubie reference storage
  const setCubieRef = useCallback((el: THREE.Group | null, index: number) => {
    if (el) {
      cubieRefs.current[index] = el
    }
  }, [])

  // Animation speed parameters
  const rotationSpeed = 0.85 // Animation duration
  const cubeRotationSpeed = 0.05 // Smooth global rotation speed

  // Animation loop - runs on each frame
  useFrame((_, delta) => {
    // Continue cube rotation even when faces are rotating
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * cubeRotationSpeed
      groupRef.current.rotation.x += delta * (cubeRotationSpeed / 2)
    }

    // Animate rotation if active
    if (rotationState.isRotating && rotationState.currentFace) {
      const face = rotationState.currentFace
      const rotationDuration = rotationSpeed // seconds
      const newProgress = rotationState.progress + delta / rotationDuration
      let isRotationComplete = false
      
      // Calculate the angle for this frame
      let progress = Math.min(newProgress, 1.0)
      const easedProgress = easeInOutCubic(progress)
      const angleToRotate = (Math.PI / 2) * easedProgress // 90 degrees max
      
      // Handle rotation completion
      if (progress >= 1.0) {
        isRotationComplete = true
        
        // Apply final rotation with grid snapping
        const finalPositions = rotateLayer(face)
        setCubiePositions(finalPositions)
        
        // Directly update cubie positions for visual consistency
        const cubiesInLayer = getCubiesInLayer(face)
        cubiesInLayer.forEach(index => {
          const cubie = cubieRefs.current[index]
          if (cubie) {
            const tempCubie = finalPositions[index]
            cubie.position.copy(tempCubie.position)
            cubie.quaternion.copy(tempCubie.quaternion)
          }
        })
      } else {
        // Apply calculated rotation to the layer
        const rotatedPositions = calculateLayerRotation(face, angleToRotate)
        const cubiesInLayer = getCubiesInLayer(face)
        
        // Update visual positions for layer cubies
        cubiesInLayer.forEach(index => {
          const cubie = cubieRefs.current[index]
          if (cubie) {
            const tempCubie = rotatedPositions[index]
            cubie.position.copy(tempCubie.position)
            cubie.quaternion.copy(tempCubie.quaternion)
          }
        })
      }
      
      // Handle rotation completion
      if (isRotationComplete) {
        setRotationState(prev => ({
          ...prev,
          isRotating: false,
          inRotationPause: true,
          progress: 0,
        }))
        
        // Schedule next rotation with pause
        setTimeout(() => startNextRotation(), 1500)
      } else {
        setRotationState(prev => ({
          ...prev,
          progress: newProgress,
        }))
      }
    }
  })

  // Render the cube with all cubies
  return (
    <group ref={groupRef}>
      {cubiePositions.map((cubie, index) => (
        <Cubie 
          key={index} 
          position={cubie.position}
          indices={cubie.indices}
          ref={(el) => setCubieRef(el, index)}
        />
      ))}
    </group>
  )
}

// Interface for Cubie component props
interface CubieProps {
  position: THREE.Vector3
  indices: THREE.Vector3
}

// Individual cubie component with colored faces and beveled edges
const Cubie = React.forwardRef<THREE.Group, CubieProps>(({ position, indices }, ref) => {
  const size = 0.99
  const radius = 0.097777 // Radius for edge rounding/beveling
  
  // Define cubie colors - traditional Rubik's cube colors
  const colors = {
    right: indices.x === 1 ? 0x000000 : 0x000000, // Red
    left: indices.x === -1 ? 0x000000 : 0x000000, // Orange
    top: indices.y === 1 ? 0x000000 : 0x000000,   // White
    bottom: indices.y === -1 ? 0x000000 : 0x000000, // Yellow
    front: indices.z === 1 ? 0x000000 : 0x000000,  // Green
    back: indices.z === -1 ? 0x000000 : 0x000000,  // Blue
  }
  
  // Create materials for each face
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ 
      color: colors.right,
      roughness: 0.35,
      metalness: 0.5,
    }),
    new THREE.MeshStandardMaterial({ 
      color: colors.left,
      roughness: 0.35,
      metalness: 0.5,
    }),
    new THREE.MeshStandardMaterial({ 
      color: colors.top,
      roughness: 0.35,
      metalness: 0.5,
    }),
    new THREE.MeshStandardMaterial({ 
      color: colors.bottom,
      roughness: 0.35,
      metalness: 0.5,
    }),
    new THREE.MeshStandardMaterial({ 
      color: colors.front,
      roughness: 0.35,
      metalness: 0.5,
    }),
    new THREE.MeshStandardMaterial({ 
      color: colors.back,
      roughness: 0.35,
      metalness: 0.5,
    }),
  ], [indices])
  
  return (
    <group ref={ref} position={position}>
      <RoundedBox 
        args={[size, size, size]} 
        radius={radius} 
        smoothness={10} 
        castShadow 
        receiveShadow
      >
        <primitive object={materials} attach="material" />
      </RoundedBox>
    </group>
  )
})

// Main component that sets up the Three.js scene with a Rubik's Cube
export default function RubiksCube() {
  return (
    <div className=" bg-black" style={{ width: "85vw", height: "85vh" }}>
      <Canvas camera={{ position: [15, 15, 15], fov: 25 }}>
        <color attach="background" args={["#bbbbbb"]} />
        
        {/* Enhanced lighting */}
        <ambientLight intensity={0.8} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1.5} castShadow />
        <pointLight position={[-10, -10, -10]} intensity={0.8} />
        <pointLight position={[5, 15, -5]} intensity={0.6} color="#ffffff" />
        <pointLight position={[-5, -15, 5]} intensity={0.5} color="#ffffff" />
        
        <Cube />
        <Environment preset="studio" />
        <ContactShadows position={[0, -3.5, 0]} opacity={0.4} scale={20} blur={1.5} far={4.5} />
        <BakeShadows />
        
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={5}
          maxDistance={20}
          autoRotate={false} // Disabled since we're handling rotation ourselves
        />
      </Canvas>
    </div>
  )
}