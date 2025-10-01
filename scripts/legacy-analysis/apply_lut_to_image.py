#!/usr/bin/env python3
"""
Apply LUT1D.cube to EDN_RGB_101.tif using the same inverted method as quadGEN
"""

import numpy as np
from PIL import Image
import os

def parse_cube_1d(cube_text):
    """Parse a .cube file string as a 1D LUT (matching quadGEN logic)"""
    lines = cube_text.split('\n')
    domain_min = 0.0
    domain_max = 1.0
    declared_size = None
    samples = []
    
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#") or s.upper().startswith("TITLE"):
            continue
            
        if s.upper().startswith("LUT_1D_SIZE"):
            parts = s.split()
            if len(parts) > 1:
                declared_size = int(parts[1])
            continue
            
        if s.upper().startswith("DOMAIN_MIN"):
            parts = s.split()
            if len(parts) > 1:
                domain_min = float(parts[1])
            continue
            
        if s.upper().startswith("DOMAIN_MAX"):
            parts = s.split()
            if len(parts) > 1:
                domain_max = float(parts[1])
            continue
            
        # Try to parse as numeric data
        try:
            nums = [float(x) for x in s.split()]
            if len(nums) >= 1 and len(nums) <= 3:
                samples.append(nums[0])  # Take first channel for 1D
        except ValueError:
            continue
    
    # Trim to declared size if specified
    if declared_size is not None and len(samples) >= declared_size:
        samples = samples[:declared_size]
    
    return {
        'domain_min': domain_min,
        'domain_max': domain_max,
        'samples': samples
    }

def create_pchip_spline(x, y):
    """PCHIP interpolation (matching quadGEN logic)"""
    n = len(x)
    if n < 2:
        return lambda t: y[0] if y else 0
    
    # Calculate intervals and finite differences
    h = [x[i+1] - x[i] for i in range(n-1)]
    delta = [(y[i+1] - y[i]) / h[i] for i in range(n-1)]
    
    # Calculate slopes using PCHIP method
    slopes = [0] * n
    slopes[0] = delta[0]  # First point
    slopes[n-1] = delta[n-2]  # Last point
    
    for i in range(1, n-1):
        if delta[i-1] * delta[i] <= 0:
            slopes[i] = 0  # Direction change
        else:
            # Weighted harmonic mean
            w1 = 2 * h[i] + h[i-1]
            w2 = h[i] + 2 * h[i-1]
            slopes[i] = (w1 + w2) / (w1 / delta[i-1] + w2 / delta[i])
    
    def interpolate(t):
        if t <= x[0]:
            return y[0]
        if t >= x[n-1]:
            return y[n-1]
        
        # Find interval
        i = 0
        while i < n-1 and x[i+1] < t:
            i += 1
        
        # Normalize t within interval
        dt = t - x[i]
        h_i = h[i]
        t_norm = dt / h_i
        
        # Hermite basis functions
        h00 = 2 * t_norm**3 - 3 * t_norm**2 + 1
        h10 = t_norm**3 - 2 * t_norm**2 + t_norm
        h01 = -2 * t_norm**3 + 3 * t_norm**2
        h11 = t_norm**3 - t_norm**2
        
        return y[i] * h00 + h_i * slopes[i] * h10 + y[i+1] * h01 + h_i * slopes[i+1] * h11
    
    return interpolate

def apply_lut_inverted_to_pixel(pixel_value, lut_data):
    """Apply LUT with inverted logic to a single pixel value (0-255 range)"""
    samples = lut_data['samples']
    domain_min = lut_data['domain_min']
    domain_max = lut_data['domain_max']
    
    K = len(samples)
    if K < 2:
        return pixel_value
    
    # Create x coordinates for LUT points
    lut_x = [domain_min + (i / (K - 1)) * (domain_max - domain_min) for i in range(K)]
    
    # Create PCHIP interpolation function
    interpolation_func = create_pchip_spline(lut_x, samples)
    
    # INVERTED APPLICATION: find LUT input that produces desired output
    desired_output = pixel_value / 255.0  # Normalize to 0-1
    
    # Search through LUT values to find inverse mapping
    best_input_t = desired_output  # Default fallback
    min_difference = float('inf')
    
    for i in range(K):
        lut_input_t = lut_x[i]
        lut_output_value = interpolation_func(lut_input_t)
        difference = abs(lut_output_value - desired_output)
        
        if difference < min_difference:
            min_difference = difference
            best_input_t = lut_input_t
    
    # Binary search refinement
    if K > 2:
        search_range = (domain_max - domain_min) / (K - 1)
        low = max(domain_min, best_input_t - search_range)
        high = min(domain_max, best_input_t + search_range)
        
        for _ in range(10):
            mid = (low + high) / 2
            mid_output = interpolation_func(mid)
            
            if abs(mid_output - desired_output) < 1e-6:
                best_input_t = mid
                break
            
            if mid_output < desired_output:
                low = mid
            else:
                high = mid
            best_input_t = mid
    
    # Convert back to 0-255 range
    return int(round(max(0, min(1, best_input_t)) * 255))

def apply_lut_to_image(image_array, lut_data):
    """Apply LUT to entire image array"""
    print("Applying LUT to image...")
    
    # Get image dimensions
    if len(image_array.shape) == 3:
        height, width, channels = image_array.shape
        result = np.zeros_like(image_array)
        
        # Apply LUT to each pixel in each channel
        total_pixels = height * width * channels
        processed = 0
        
        for y in range(height):
            for x in range(width):
                for c in range(channels):
                    original_value = image_array[y, x, c]
                    corrected_value = apply_lut_inverted_to_pixel(original_value, lut_data)
                    result[y, x, c] = corrected_value
                    processed += 1
                    
                    # Progress indicator
                    if processed % 100000 == 0:
                        percent = (processed / total_pixels) * 100
                        print(f"Progress: {percent:.1f}%")
        
    else:
        # Grayscale image
        height, width = image_array.shape
        result = np.zeros_like(image_array)
        
        total_pixels = height * width
        
        for y in range(height):
            for x in range(width):
                original_value = image_array[y, x]
                corrected_value = apply_lut_inverted_to_pixel(original_value, lut_data)
                result[y, x] = corrected_value
                
                if (y * width + x) % 50000 == 0:
                    percent = ((y * width + x) / total_pixels) * 100
                    print(f"Progress: {percent:.1f}%")
    
    print("LUT application complete!")
    return result

def main():
    # Check for input files
    if not os.path.exists('LUT1D.cube'):
        print("Error: LUT1D.cube not found in current directory")
        return
        
    if not os.path.exists('EDN_RGB_101.tif'):
        print("Error: EDN_RGB_101.tif not found in current directory")
        return
    
    # Read the LUT file
    print("Reading LUT1D.cube...")
    with open('LUT1D.cube', 'r') as f:
        cube_content = f.read()
    
    # Parse the LUT
    lut_data = parse_cube_1d(cube_content)
    print(f"Parsed LUT: {len(lut_data['samples'])} points")
    print(f"Domain: {lut_data['domain_min']} to {lut_data['domain_max']}")
    
    # Load the image
    print("Loading EDN_RGB_101.tif...")
    image = Image.open('EDN_RGB_101.tif')
    print(f"Image mode: {image.mode}")
    print(f"Image size: {image.size}")
    
    # Convert to numpy array
    image_array = np.array(image)
    print(f"Image array shape: {image_array.shape}")
    print(f"Image array dtype: {image_array.dtype}")
    
    # Apply LUT using quadGEN's inverted method
    corrected_array = apply_lut_to_image(image_array, lut_data)
    
    # Convert back to PIL Image
    corrected_image = Image.fromarray(corrected_array.astype(np.uint8))
    
    # Save the result
    output_filename = 'EDN_RGB_101_quadGEN_corrected.tif'
    corrected_image.save(output_filename, compression='lzw')
    
    print(f"\nImage processing complete!")
    print(f"Original: EDN_RGB_101.tif")
    print(f"Corrected: {output_filename}")
    print(f"LUT applied: LUT1D.cube ({len(lut_data['samples'])} points)")
    print(f"Method: Inverted PCHIP interpolation (matching quadGEN)")

if __name__ == "__main__":
    main()