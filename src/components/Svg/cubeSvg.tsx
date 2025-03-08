
const Rotating3DCube = () => {
  return (
    <svg viewBox='0 0 100 100' width='4svh' height='4svh' xmlns='http://www.w3.org/2000/svg'>
      <style>
        {`
          @keyframes rotateCube {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .cube {
            animation: rotateCube 4s linear infinite;
            transform-origin: 50% 50%;
            transform-box: fill-box;
          }
          rect {
            fill: black;
            stroke: white;
            stroke-width: 0.5;
          }
        `}
      </style>
      <g className='cube'>
        <rect x='10' y='10' width='20' height='20' />
        <rect x='35' y='10' width='20' height='20' />
        <rect x='60' y='10' width='20' height='20' />
        <rect x='10' y='35' width='20' height='20' />
        <rect x='35' y='35' width='20' height='20' />
        <rect x='60' y='35' width='20' height='20' />
        <rect x='10' y='60' width='20' height='20' />
        <rect x='35' y='60' width='20' height='20' />
        <rect x='60' y='60' width='20' height='20' />
      </g>
    </svg>
  );
};

export default Rotating3DCube;
