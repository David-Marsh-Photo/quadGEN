#!/usr/bin/env python3
"""
Plot LUT1D.cube using the same logic as quadGEN app
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt

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

def apply_lut_inverted(values, lut_data, max_value=65535):
    """Apply LUT with inverted logic (matching current quadGEN implementation)"""
    samples = lut_data['samples']
    domain_min = lut_data['domain_min']
    domain_max = lut_data['domain_max']
    
    K = len(samples)
    if K < 2:
        return values
    
    # Create x coordinates for LUT points
    lut_x = [domain_min + (i / (K - 1)) * (domain_max - domain_min) for i in range(K)]
    
    # Create PCHIP interpolation function
    interpolation_func = create_pchip_spline(lut_x, samples)
    
    result = []
    for v in values:
        # INVERTED APPLICATION: find LUT input that produces desired output
        desired_output = v / max_value  # Normalize to 0-1
        
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
        
        # Convert back to maxValue range
        result.append(round(max(0, min(1, best_input_t)) * max_value))
    
    return result

def main():
    # Read the LUT file
    try:
        with open('LUT1D.cube', 'r') as f:
            cube_content = f.read()
    except FileNotFoundError:
        print("Error: LUT1D.cube not found in current directory")
        return
    
    # Parse the LUT
    lut_data = parse_cube_1d(cube_content)
    print(f"Parsed LUT: {len(lut_data['samples'])} points")
    print(f"Domain: {lut_data['domain_min']} to {lut_data['domain_max']}")
    print(f"Sample values range: {min(lut_data['samples']):.3f} to {max(lut_data['samples']):.3f}")
    
    # Generate test data (linear ramp like quadGEN)
    N = 256
    max_value = 65535
    test_values = [round(i * max_value / (N - 1)) for i in range(N)]
    
    # Apply LUT with current (inverted) logic
    corrected_values = apply_lut_inverted(test_values, lut_data, max_value)
    
    # Convert to percentages for plotting
    input_percentages = [v / max_value * 100 for v in test_values]
    output_percentages = [v / max_value * 100 for v in corrected_values]
    
    # Also plot the raw LUT data for comparison
    lut_x_norm = [lut_data['domain_min'] + (i / (len(lut_data['samples']) - 1)) * 
                  (lut_data['domain_max'] - lut_data['domain_min']) 
                  for i in range(len(lut_data['samples']))]
    lut_x_percent = [x * 100 for x in lut_x_norm]
    lut_y_percent = [y * 100 for y in lut_data['samples']]
    
    # Create the plot
    plt.figure(figsize=(12, 8))
    
    # Plot the corrected curve (quadGEN result)
    plt.plot(input_percentages, output_percentages, 'b-', linewidth=2, 
             label='quadGEN Corrected Output (Inverted LUT Application)')
    
    # Plot the raw LUT data
    plt.plot(lut_x_percent, lut_y_percent, 'ro-', markersize=4, linewidth=1,
             label='Raw LUT Data Points')
    
    # Plot identity line for reference
    plt.plot([0, 100], [0, 100], 'k--', alpha=0.5, linewidth=1, label='Linear (No Correction)')
    
    plt.xlabel('Input Level (%)')
    plt.ylabel('Output Level (%)')
    plt.title('LUT1D.cube Analysis - Current quadGEN Implementation\n(Inverted LUT Application)')
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.xlim(0, 100)
    plt.ylim(0, 100)
    
    # Add some statistics as text
    plt.text(0.02, 0.98, f'LUT Points: {len(lut_data["samples"])}\nInterpolation: PCHIP\nInversion: Applied', 
             transform=plt.gca().transAxes, verticalalignment='top',
             bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
    
    plt.tight_layout()
    plt.savefig('LUT1D_analysis.png', dpi=150, bbox_inches='tight')
    
    print("Graph saved as 'LUT1D_analysis.png'")
    print(f"\nSummary:")
    print(f"- Input range: 0% to 100%")
    print(f"- Raw LUT range: {min(lut_y_percent):.1f}% to {max(lut_y_percent):.1f}%")
    print(f"- Corrected output range: {min(output_percentages):.1f}% to {max(output_percentages):.1f}%")

if __name__ == "__main__":
    main()
