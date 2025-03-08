import Cube from './components/Cube';
import './App.css';
import { Github } from 'lucide-react';
import  Rotating3DCube  from './components/Svg/cubeSvg';
/**
 * The main application component.
 *
 * This component renders a `Helmet` component for meta tags, a `Cube` component
 * for the interactive 3D cube visualization, and a footer with a link to the
 * GitHub repository.
 *
 * @returns The main application component.
 */
function App() {
  return (
    <div className=' mx-3 min-h-screen flex flex-col items-center justify-center'>
     

      <div className='mb-4'>
        <Cube />
      </div>

      <div className=' p-4 rounded-lg '>
        <a
          href='https://github.com/Harijohnson/Cube'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center text-black hover:text-gray-900 transition-colors'
        >

          
          <Github className='mr-2' />
          
          GitHub  
        </a>
        <div className='absolute right-10 bottom-0 '>
          <div>
            <Rotating3DCube />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
