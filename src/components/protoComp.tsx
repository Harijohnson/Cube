"use client"

import React, { useRef, useMemo, useState, useEffect, useCallback } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei"
import * as THREE from "three"

/**
 * Enhanced cubic easing function for smoother acceleration/deceleration
 * Provides a more natural animation curve compared to linear
 * @param t - Value between 0 and 1 representing animation progress
 * @returns Eased value between 0 and 1
 */
const easeInOutCubic = (t: number) => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// Pre-normalize vectors once to avoid repeated normalization
// These define rotation axes for each face of the cube
const ROTATION_AXES = {
  TOP: new THREE.Vector3(0, 1, 0).normalize(),
  RIGHT: new THREE.Vector3(1, 0, 0).normalize(),
  BOTTOM: new THREE.Vector3(0, -1, 0).normalize(),
  LEFT: new THREE.Vector3(-1, 0, 0).normalize(),
  FRONT: new THREE.Vector3(0, 0, 1).normalize(),
  BACK: new THREE.Vector3(0, 0, -1).normalize(),
}

// Fixed rotation directions for each face
// Positive = clockwise when looking at that face
const ROTATION_DIRECTIONS = {
  RIGHT: 1,
  LEFT: 1,

  TOP: 1,
  BOTTOM: 1,

  FRONT: 1,
  BACK: 1,
}

/**
 * Layer indices for each face
 * These define which cubies belong to each face based on their position
 * along a specific axis (x, y, or z) with a specific value (-1, 0, or 1)
 */
const LAYER_INDICES: Record<string, { axis: "x" | "y" | "z", value: number }> = {
  RIGHT: { axis: "x", value: 1 },
  LEFT: { axis: "x", value: -1 },

  TOP: { axis: "y", value: 1 },
  BOTTOM: { axis: "y", value: -1 },

  FRONT: { axis: "z", value: 1 },
  BACK: { axis: "z", value: -1 },
}

// Face rotation sequence - defines the order in which faces rotate
const ROTATION_SEQUENCE = [
  "RIGHT",
  "FRONT", 
  "BACK",
  "LEFT", 
  "TOP", 
  "BOTTOM",
]

// Map axis string to vector index for faster lookups
const AXIS_TO_INDEX = {
  "x": 0,
  "y": 1,
  "z": 2
}

// Constants for cube dimensions and precision
const CUBE_SIZE = 1.0
const CUBE_GAP = 0.000001
const EPSILON = 0.0000001 // Floating point precision threshold

/**
 * Generates an array of target positions for a solved cube.
 * Creates a 3x3x3 grid of positions, excluding the center cube.
 * 
 * @returns An array of 3D coordinates (x, y, z) representing the target positions
 */
function getTargetPositions() {
  const positions = [];
  
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        // Skip the center cube
        if (x === 0 && y === 0 && z === 0) continue;
        
        // Store the target position
        positions.push({ x, y, z });
      }
    }
  }
  return positions;
}

/**
 * Main Cube component that handles the Rubik's Cube logic and animation
 */
function Cube() {
  // Reference to the entire cube group
  const groupRef = useRef<THREE.Group>(null)
  
  // References to individual cubies for direct manipulation
  const [cubieRefs, setCubieRefs] = useState<React.RefObject<THREE.Group | null>[]>([])
  
  // Type definition for cubie position data
  type CubiePosition = {
    position: THREE.Vector3;   // World position
    indices: THREE.Vector3;    // Grid indices (-1, 0, 1)
    quaternion: THREE.Quaternion; // Orientation
    type: string;              // Corner, edge, or center
  }
  
  // Current positions of all cubies
  const [cubiePositions, setCubiePositions] = useState<CubiePosition[]>([])
  
  // State to track rotation animation
  const [rotationState, setRotationState] = useState<{
    isRotating: boolean;         // Whether rotation is in progress
    currentFace: string | null;  // Current face being rotated
    progress: number;            // Animation progress (0-1)
    sequenceIndex: number;       // Current index in rotation sequence
    inSequencePause: boolean;    // Pause between full sequences
    inRotationPause: boolean;    // Pause between individual rotations
    overshootPhase: boolean;     // Overshoot animation phase
    overshootReturn: boolean;    // Return from overshoot phase
  }>({
    isRotating: false,
    currentFace: null,
    progress: 0,
    sequenceIndex: 0,
    inSequencePause: false,
    inRotationPause: false,
    overshootPhase: false,
    overshootReturn: false,
  })

  /**
   * Generate initial positions for all 26 cubies
   * Calculated once and memoized to avoid recalculation
   */
  const initialCubiePositions = useMemo(() => {
    const positions: CubiePosition[] = []
    const targetPositions = getTargetPositions();
    
    targetPositions.forEach(pos => {
      const { x, y, z } = pos;
      
      // Calculate position with gap between cubies
      const posX = x * (CUBE_SIZE + CUBE_GAP);
      const posY = y * (CUBE_SIZE + CUBE_GAP);
      const posZ = z * (CUBE_SIZE + CUBE_GAP);
      
      // Determine cubie type based on position
      const zeroCount = [x, y, z].filter(coord => coord === 0).length;
      let type = "corner";
      if (zeroCount === 1) type = "edge";
      else if (zeroCount === 2) type = "center";
      
      positions.push({
        position: new THREE.Vector3(posX, posY, posZ),
        indices: new THREE.Vector3(x, y, z),
        quaternion: new THREE.Quaternion(),
        type,
      });
    });
    
    return positions;
  }, [])

  // Initialize cubie refs and positions
  useEffect(() => {
    // Create refs for all cubies
    setCubieRefs(new Array(initialCubiePositions.length).fill(null).map(() => React.createRef<THREE.Group>()))
    // Set initial positions
    setCubiePositions(initialCubiePositions)
  }, [initialCubiePositions])

  // Type for partial updates to rotation state
  interface RotationStateUpdates {
    isRotating?: boolean;
    currentFace?: string | null;
    progress?: number;
    sequenceIndex?: number;
    inSequencePause?: boolean;
    inRotationPause?: boolean;
    overshootPhase?: boolean;
    overshootReturn?: boolean;
  }

  /**
   * Update rotation state with partial changes
   * @param updates - Object with properties to update
   */
  const updateRotationState = useCallback((updates: RotationStateUpdates): void => {
    setRotationState((prev) => ({ ...prev, ...updates }))
  }, [])

  /**
   * Start the next rotation in the sequence
   * Handles transitions between rotations and sequence pauses
   */
  const startNextRotation = useCallback(() => {
    const nextSequenceIndex = (rotationState.sequenceIndex + 1) % ROTATION_SEQUENCE.length

    console.log("startNextRotation", rotationState.sequenceIndex, nextSequenceIndex)
    if (nextSequenceIndex === 0) {
      // End of sequence, pause before starting a new one
      updateRotationState({
        inRotationPause: false,
        inSequencePause: true,
        sequenceIndex: nextSequenceIndex,
      })

      setTimeout(() => {
        // Start new sequence after pause
        updateRotationState({
          isRotating: true,
          inSequencePause: false,
          currentFace: ROTATION_SEQUENCE[0],
          progress: 0,
          overshootPhase: false,
          overshootReturn: false,
        })
      }, 1500) // 1.5 second pause between sequences
    } else {
      // Continue to next rotation in sequence
      updateRotationState({
        isRotating: true,
        inRotationPause: false,
        sequenceIndex: nextSequenceIndex,
        currentFace: ROTATION_SEQUENCE[nextSequenceIndex],
        progress: 0,
        overshootPhase: false,
        overshootReturn: false,
      })
    }
  }, [rotationState.sequenceIndex, updateRotationState])

  /**
   * Get the world center point of a face
   * @param face - Face identifier (TOP, RIGHT, etc.)
   * @returns Vector3 representing face center point
   */
  const getFaceCenter = useCallback((face: keyof typeof ROTATION_AXES): THREE.Vector3 => {
    const { axis, value } = LAYER_INDICES[face];
    const center = new THREE.Vector3(0, 0, 0);
    center[axis] = value * (CUBE_SIZE + CUBE_GAP);
    console.log('center',center)
    return center;

  }, []);

  /**
   * Determine which cubies belong to a specific face
   * @param face - Face identifier (TOP, RIGHT, etc.)
   * @returns Array of cubie indices that are part of this face
   */
  const getCubiesInLayer = useCallback((face: keyof typeof ROTATION_AXES): number[] => {
    const { axis, value } = LAYER_INDICES[face];
    const axisIndex = AXIS_TO_INDEX[axis];
    
    return cubiePositions
      .map((cubie, i) => {
        // Use epsilon comparison for floating point precision
        return Math.abs(cubie.indices.getComponent(axisIndex) - value) < EPSILON ? i : -1;
      })
      .filter(i => i !== -1);
  }, [cubiePositions]);

  /**
   * Snap a vector to integer coordinates to prevent floating point drift
   * @param vec - Vector3 to snap
   * @returns New Vector3 with components snapped to integers
   */
  const snapToGrid = useCallback((vec: THREE.Vector3): THREE.Vector3 => {
    // For each component, find the closest integer value
    const x = Math.abs(vec.x) < EPSILON ? 0 : Math.sign(vec.x) * Math.round(Math.abs(vec.x));
    const y = Math.abs(vec.y) < EPSILON ? 0 : Math.sign(vec.y) * Math.round(Math.abs(vec.y));
    const z = Math.abs(vec.z) < EPSILON ? 0 : Math.sign(vec.z) * Math.round(Math.abs(vec.z));
    
    return new THREE.Vector3(x, y, z);
  }, []);

  /**
   * Calculate intermediate positions for layer rotation animation
   * @param face - Face identifier (TOP, RIGHT, etc.)
   * @param angle - Rotation angle in radians
   * @returns Array of updated cubie positions
   */
  const calculateLayerRotation = useCallback((face: keyof typeof ROTATION_AXES, angle: number) => {
    const cubiesInLayer = getCubiesInLayer(face);
    const axis = ROTATION_AXES[face]; // Pre-normalized, no need to clone
    const direction = ROTATION_DIRECTIONS[face];
    const centerPoint = getFaceCenter(face);
    
    // Calculate rotation once outside the loop
    const rotationQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle * direction);
    
    return cubiePositions.map((cubie, index) => {
      // Skip cubies not in this layer
      if (!cubiesInLayer.includes(index)) {
        return { ...cubie };
      }
      
      const newPosition = cubie.position.clone();
      const newIndices = cubie.indices.clone();
      const newQuaternion = cubie.quaternion.clone();
      
      // Calculate position relative to rotation center
      newPosition.sub(centerPoint);
      // Apply rotation
      newPosition.applyAxisAngle(axis, angle * direction);
      // Add back center offset
      newPosition.add(centerPoint);
      
      // Rotate indices (they're already centered around 0)
      newIndices.applyAxisAngle(axis, angle * direction);
      
      // Update orientation quaternion
      newQuaternion.premultiply(rotationQuat);
      
      return {
        ...cubie,
        position: newPosition,
        indices: newIndices,
        quaternion: newQuaternion
      };
    });
  }, [cubiePositions, getCubiesInLayer, getFaceCenter]);

  /**
   * Apply a complete 90-degree rotation and snap to grid
   * @param face - Face identifier (TOP, RIGHT, etc.)
   * @returns Array of updated cubie positions with indices snapped to grid
   */
  const rotateLayer = useCallback((face: keyof typeof ROTATION_AXES): CubiePosition[] => {
    const rotatedPositions = calculateLayerRotation(face, Math.PI / 2);
    
    // Snap indices to grid to prevent floating point errors
    return rotatedPositions.map(cubie => ({
      ...cubie,
      indices: snapToGrid(cubie.indices)
    }));
  }, [calculateLayerRotation, snapToGrid]);

  /**
   * Animation loop - runs on each frame
   */
  useFrame((_, delta) => {
    // Gentle overall cube rotation
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.01;
      groupRef.current.rotation.x += delta * 0.005;
    }

    if (rotationState.isRotating && rotationState.currentFace) {
      const face = rotationState.currentFace as keyof typeof ROTATION_AXES;
      const cubiesInLayer = getCubiesInLayer(face);
      
      // Animation timing variables
      const rotationDuration = 0.8; // seconds per rotation
      const newProgress = rotationState.progress + delta / rotationDuration;
      let isRotationComplete = false;
      let angleToRotate = 0;
      
      // Pre-calculate constants for animation phases
      const baseRotation = Math.PI / 2; // 90 degrees
      const overshootAmount = THREE.MathUtils.degToRad(3); // 3 degrees overshoot

      // Handle different animation phases
      if (rotationState.overshootPhase) {
        // Overshoot phase - rotate slightly past 90 degrees
        if (newProgress >= 1) {
          // Overshoot complete, start return phase
          updateRotationState({
            overshootPhase: false,
            overshootReturn: true,
            progress: 0,
          });
          angleToRotate = baseRotation + overshootAmount;
        } else {
          // During overshoot
          const easedProgress = easeInOutCubic(newProgress);
          angleToRotate = baseRotation * easedProgress + overshootAmount * easedProgress;
        }
      } else if (rotationState.overshootReturn) {
        // Return from overshoot back to exactly 90 degrees
        if (newProgress >= 1) {
          // Return complete, rotation is done
          isRotationComplete = true;
          angleToRotate = baseRotation; // Final position at exactly 90 degrees
          
          // Apply final 90-degree rotation with grid snapping
          const finalPositions = rotateLayer(face);
          setCubiePositions(finalPositions);
        } else {
          // During return
          const easedProgress = easeInOutCubic(newProgress);
          angleToRotate = baseRotation + overshootAmount * (1 - easedProgress);
        }
      } else {
        // Initial rotation phase
        if (newProgress >= 1) {
          // Ready for overshoot
          updateRotationState({
            overshootPhase: true,
            progress: 0,
          });
          angleToRotate = baseRotation; // 90 degrees
        } else {
          // During initial rotation
          const easedProgress = easeInOutCubic(newProgress);
          angleToRotate = baseRotation * easedProgress;
        }
      }

      // Calculate intermediate positions for this animation frame
      // We're only calculating once and applying to relevant cubies
      const tempPositions = calculateLayerRotation('TOP', angleToRotate);
      
      // Update visual positions for animation
      cubiesInLayer.forEach(index => {
        if (cubieRefs[index]?.current) {
          const tempCubie = tempPositions[index];
          
          // Apply current animation frame position and rotation
          cubieRefs[index].current.position.copy(tempCubie.position);
          cubieRefs[index].current.quaternion.copy(tempCubie.quaternion);
        }
      });

      if (isRotationComplete) {
        // Animation complete - update state and schedule next rotation
        updateRotationState({
          isRotating: false,
          inRotationPause: true,
          progress: 0,
          overshootPhase: false,
          overshootReturn: false,
        });

        // Pause before next rotation
        setTimeout(startNextRotation, 1000); 
      } else {
        // Continue animation
        updateRotationState({ progress: newProgress });
      }
    } else if (!rotationState.inRotationPause && !rotationState.inSequencePause && !rotationState.isRotating) {
      // Start first rotation if not already animating or paused
      updateRotationState({
        isRotating: true,
        currentFace: ROTATION_SEQUENCE[0],
        progress: 0,
        sequenceIndex: 0,
        inSequencePause: false,
        inRotationPause: false,
        overshootPhase: false,
        overshootReturn: false,
      });
    }
    
    // Update all cubies to their correct positions when not animating
    if (!rotationState.isRotating) {
      cubiePositions.forEach((cubie, index) => {
        if (cubieRefs[index]?.current) {
          cubieRefs[index].current.position.copy(cubie.position);
          cubieRefs[index].current.quaternion.copy(cubie.quaternion);
        }
      });
    }
  });

  // Render the cube with all cubies
  return (
    <group ref={groupRef}>
      {cubiePositions.map((cubie, index) => (
        <Cubie 
          key={index} 
          index={index}
          type={cubie.type}
          ref={cubieRefs[index]}
        />
      ))}
    </group>
  );
}

/**
 * Interface for Cubie component props
 */
interface CubieProps {
  index: number;
  type: string; // "corner", "edge", or "center"
}

/**
 * Individual cubie component with optimized geometry
 */
const Cubie = React.forwardRef<THREE.Group, CubieProps>(({ type }, ref) => {
  // Create a beveled cube geometry - memoized to avoid recreation
  const geometry = useMemo(() => {
    const size = 0.95;
    const bevelSize = 0.15;

    // Create a box with beveled edges using a 2D shape extruded to 3D
    const shape = new THREE.Shape();
    shape.moveTo(-size / 2 + bevelSize, -size / 2);
    shape.lineTo(size / 2 - bevelSize, -size / 2);
    shape.quadraticCurveTo(size / 2, -size / 2, size / 2, -size / 2 + bevelSize);
    shape.lineTo(size / 2, size / 2 - bevelSize);
    shape.quadraticCurveTo(size / 2, size / 2, size / 2 - bevelSize, size / 2);
    shape.lineTo(-size / 2 + bevelSize, size / 2);
    shape.quadraticCurveTo(-size / 2, size / 2, -size / 2, size / 2 - bevelSize);
    shape.lineTo(-size / 2, -size / 2 + bevelSize);
    shape.quadraticCurveTo(-size / 2, -size / 2, -size / 2 + bevelSize, -size / 2);

    const extrudeSettings = {
      steps: 1,
      depth: size,
      bevelEnabled: true,
      bevelThickness: bevelSize,
      bevelSize: bevelSize,
      bevelOffset: 0,
      bevelSegments: 3,
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, []);
  
  // Render a black cubie with slight metallic finish
  return (
    <group ref={ref}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial 
          color="#000000" 
          metalness={0.8} 
          roughness={0.2} 
          envMapIntensity={1} 
        />
      </mesh>
    </group>
  );
});

/**
 * Main component that sets up the Three.js scene with a Rubik's Cube
 */
export default function RubiksCube() {
  return (
    <div className="w-screen h-screen bg-black">
      <Canvas camera={{ position: [15, 15, 15], fov: 25 }}>
        <color attach="background" args={["#050505"]} />
        <ambientLight intensity={0.7} /> 
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1.2} castShadow />
        <pointLight position={[-10, -10, -10]} intensity={0.7} />
        <Cube />
        <Environment preset="warehouse" />
        <ContactShadows position={[0, -3.5, 0]} opacity={0.4} scale={20} blur={1.5} far={4.5} />
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={5}
          maxDistance={20}
          autoRotate={true}
          autoRotateSpeed={0.3}
        />
      </Canvas>
    </div>
  );
}